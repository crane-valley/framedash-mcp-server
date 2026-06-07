import { Buffer } from "node:buffer";
import process from "node:process";
import type { Readable, Writable } from "node:stream";
import type {
	Transport,
	TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

/** Hard cap on a single JSON-RPC frame: 4 MB. Lines larger than this are rejected. */
const MAX_LINE_BYTES = 4 * 1024 * 1024;

/**
 * Stdio transport for an MCP server that responds with a JSON-RPC `Parse error`
 * envelope (-32700, id null) on stdout when stdin contains a non-JSON line.
 *
 * The upstream `StdioServerTransport` forwards parse failures to an optional
 * `onerror` hook but never replies on the wire, so a client sending a malformed
 * frame never learns it was dropped. JSON-RPC 2.0 requires an error response
 * with id=null for unparseable input.
 */
export class StrictStdioServerTransport implements Transport {
	private readonly _stdin: Readable;
	private readonly _stdout: Writable;
	// Pending bytes for the in-flight (unterminated) line. We accumulate them in an
	// array and only call Buffer.concat once a newline arrives, so a peer that
	// streams a big payload in many small chunks pays linear cost instead of O(N^2).
	private _chunks: Buffer[] = [];
	private _chunksLen = 0;
	// When an oversized frame is detected, we throw away the rest of that frame
	// (everything up to and including the next newline) so the trailing bytes of
	// a too-large line cannot be parsed as a fresh JSON-RPC message.
	private _discardingFrame = false;
	// True while stdout has signaled backpressure (write returned false). We
	// drop best-effort parse-error envelopes while saturated so a peer that
	// floods malformed input without reading stdout cannot pin unbounded reply
	// bytes in Node's internal buffer.
	private _stdoutSaturated = false;
	private _drainAttached = false;
	// Serialize send() writes through a single promise chain so concurrent
	// callers do not stack drain/close/error listeners on stdout (which would
	// trip Node's MaxListenersExceededWarning at >10 in flight).
	private _writeChain: Promise<void> = Promise.resolve();
	private _started = false;
	private _closed = false;

	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

	constructor(stdin: Readable = process.stdin, stdout: Writable = process.stdout) {
		this._stdin = stdin;
		this._stdout = stdout;
	}

	async start(): Promise<void> {
		if (this._started) {
			throw new Error("StrictStdioServerTransport already started");
		}
		this._started = true;
		this._stdin.on("data", this._ondata);
		this._stdin.on("error", this._onstdinError);
		// stdin EOF (peer disconnect) must propagate to onclose so the MCP server
		// shuts down instead of lingering as a zombie process.
		this._stdin.on("end", this._onstdinEnd);
	}

	async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
		const json = `${JSON.stringify(message)}\n`;
		const next = this._writeChain.then(
			() => this._writeStdout(json),
			() => this._writeStdout(json),
		);
		// Swallow the rejection on the chain so a single failed write does not
		// poison every subsequent send. Callers still see the original rejection.
		this._writeChain = next.catch(() => undefined);
		return next;
	}

	async close(): Promise<void> {
		if (this._closed) return;
		this._closed = true;
		this._stdin.off("data", this._ondata);
		this._stdin.off("error", this._onstdinError);
		this._stdin.off("end", this._onstdinEnd);
		this._chunks = [];
		this._chunksLen = 0;
		this._discardingFrame = false;
		this.onclose?.();
	}

	private _ondata = (chunk: Buffer): void => {
		// If we are discarding the tail of an oversized frame, skip ahead to the
		// next newline before resuming normal framing.
		if (this._discardingFrame) {
			const nl = chunk.indexOf(0x0a);
			if (nl === -1) return;
			this._discardingFrame = false;
			chunk = chunk.subarray(nl + 1);
			if (chunk.length === 0) return;
		}

		const projected = this._chunksLen + chunk.length;
		const nlInChunk = chunk.indexOf(0x0a);

		// No frame boundary in this chunk: just queue and bail. We cap the pending
		// buffer at MAX_LINE_BYTES so a peer that never sends a newline cannot
		// exhaust memory or pin the event loop.
		if (nlInChunk === -1) {
			if (projected > MAX_LINE_BYTES) {
				this._resetChunks();
				this._discardingFrame = true;
				this._emitParseError(
					new Error(`JSON-RPC frame exceeded ${MAX_LINE_BYTES} bytes without a newline`),
				);
				return;
			}
			this._chunks.push(chunk);
			this._chunksLen = projected;
			return;
		}

		// Newline present — flatten once and process all complete lines. If the
		// pending data + this chunk exceeds the cap and we have no terminator
		// before the cap, reset and report a parse error.
		this._chunks.push(chunk);
		this._chunksLen = projected;
		let buf = Buffer.concat(this._chunks, this._chunksLen);
		this._resetChunks();

		while (true) {
			const idx = buf.indexOf(0x0a);
			if (idx === -1) break;
			if (idx > MAX_LINE_BYTES) {
				// The frame before the newline is too large; drop it and resync to
				// the byte after the newline.
				buf = buf.subarray(idx + 1);
				this._emitParseError(
					new Error(`JSON-RPC frame exceeded ${MAX_LINE_BYTES} bytes without a newline`),
				);
				continue;
			}
			const line = buf.toString("utf8", 0, idx).replace(/\r$/, "");
			buf = buf.subarray(idx + 1);
			this._handleLine(line);
		}

		if (buf.length > 0) {
			if (buf.length > MAX_LINE_BYTES) {
				this._discardingFrame = true;
				this._emitParseError(
					new Error(`JSON-RPC frame exceeded ${MAX_LINE_BYTES} bytes without a newline`),
				);
				return;
			}
			this._chunks.push(buf);
			this._chunksLen = buf.length;
		}
	};

	private _onstdinError = (error: Error): void => {
		this.onerror?.(error);
	};

	private _onstdinEnd = (): void => {
		void this.close();
	};

	private _resetChunks(): void {
		this._chunks = [];
		this._chunksLen = 0;
	}

	private _handleLine(line: string): void {
		if (line.length === 0) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this._emitParseError(error instanceof Error ? error : new Error(detail));
			return;
		}
		this.onmessage?.(parsed as JSONRPCMessage);
	}

	private _emitParseError(error: Error): void {
		// Drop the envelope when stdout is saturated or already closed. Without
		// this drop a peer that floods malformed lines without reading stdout
		// could pin unbounded -32700 replies in Node's internal write buffer.
		// The onerror hook still surfaces every parse failure.
		if (!this._closed && !this._stdoutSaturated) {
			const envelope = {
				jsonrpc: "2.0" as const,
				id: null,
				error: { code: -32700, message: "Parse error", data: error.message },
			};
			try {
				const ok = this._stdout.write(`${JSON.stringify(envelope)}\n`);
				if (!ok) {
					this._markSaturated();
				}
			} catch (writeErr) {
				this.onerror?.(writeErr instanceof Error ? writeErr : new Error(String(writeErr)));
			}
		}
		this.onerror?.(error);
	}

	private _markSaturated(): void {
		this._stdoutSaturated = true;
		if (this._drainAttached) return;
		this._drainAttached = true;
		this._stdout.once("drain", () => {
			this._stdoutSaturated = false;
			this._drainAttached = false;
		});
	}

	private _writeStdout(json: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let written: boolean;
			try {
				written = this._stdout.write(json);
			} catch (err) {
				reject(err instanceof Error ? err : new Error(String(err)));
				return;
			}
			if (written) {
				resolve();
				return;
			}
			this._stdoutSaturated = true;
			const onDrain = () => {
				this._stdoutSaturated = false;
				cleanup();
				resolve();
			};
			const onClose = () => {
				cleanup();
				reject(new Error("stdout closed before drain"));
			};
			const onError = (err: Error) => {
				cleanup();
				reject(err);
			};
			const cleanup = () => {
				this._stdout.off("drain", onDrain);
				this._stdout.off("close", onClose);
				this._stdout.off("error", onError);
			};
			this._stdout.once("drain", onDrain);
			this._stdout.once("close", onClose);
			this._stdout.once("error", onError);
		});
	}

	/** Test helper: feed bytes through the same path as live stdin data. */
	feedForTest(chunk: Buffer | string): void {
		const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
		this._ondata(buf);
	}
}
