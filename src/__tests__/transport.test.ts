import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { StrictStdioServerTransport } from "../transport.js";

function createTransport(): { transport: StrictStdioServerTransport; stdout: PassThrough } {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const transport = new StrictStdioServerTransport(stdin, stdout);
	return { transport, stdout };
}

function readStdoutLines(stream: PassThrough): string[] {
	const text = (stream.read()?.toString() as string | undefined) ?? "";
	return text.length === 0 ? [] : text.split("\n").filter(Boolean);
}

describe("StrictStdioServerTransport", () => {
	it("emits a JSON-RPC -32700 Parse error envelope for non-JSON stdin", () => {
		const { transport, stdout } = createTransport();
		const onerror = vi.fn();
		transport.onerror = onerror;

		transport.feedForTest("not-valid-json\n");

		const lines = readStdoutLines(stdout);
		expect(lines).toHaveLength(1);
		const envelope = JSON.parse(lines[0]!);
		expect(envelope).toMatchObject({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32700, message: "Parse error" },
		});
		expect(typeof envelope.error.data).toBe("string");
		expect(onerror).toHaveBeenCalledOnce();
	});

	it("forwards valid JSON-RPC frames without writing a parse error", () => {
		const { transport, stdout } = createTransport();
		const onmessage = vi.fn();
		transport.onmessage = onmessage;

		const valid = { jsonrpc: "2.0", id: 1, method: "ping" };
		transport.feedForTest(`${JSON.stringify(valid)}\n`);

		expect(readStdoutLines(stdout)).toHaveLength(0);
		expect(onmessage).toHaveBeenCalledWith(valid);
	});

	it("continues processing valid frames after a malformed one", () => {
		const { transport, stdout } = createTransport();
		const onmessage = vi.fn();
		const onerror = vi.fn();
		transport.onmessage = onmessage;
		transport.onerror = onerror;

		const valid = { jsonrpc: "2.0", id: 7, method: "ping" };
		transport.feedForTest(`garbage\n${JSON.stringify(valid)}\n`);

		const lines = readStdoutLines(stdout);
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0]!).error.code).toBe(-32700);
		expect(onmessage).toHaveBeenCalledWith(valid);
		expect(onerror).toHaveBeenCalledOnce();
	});

	it("does not dispatch the trailing bytes of an oversized frame as a new message", () => {
		const { transport, stdout } = createTransport();
		const onmessage = vi.fn();
		const onerror = vi.fn();
		transport.onmessage = onmessage;
		transport.onerror = onerror;

		// 5 MB of garbage (no newline) blows past the 4 MB cap. The cap fires and
		// the transport must keep discarding the remainder of this frame —
		// including the JSON suffix — until the terminating newline.
		const garbage = Buffer.alloc(5 * 1024 * 1024, 0x41);
		transport.feedForTest(garbage);
		transport.feedForTest('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');

		// The trailing valid-looking JSON must NOT dispatch — it was framed inside
		// the oversized line and must be discarded with it.
		expect(onmessage).not.toHaveBeenCalled();

		// A subsequent fully-framed message after a real boundary should still work.
		const valid = { jsonrpc: "2.0", id: 2, method: "ping" };
		transport.feedForTest(`${JSON.stringify(valid)}\n`);
		expect(onmessage).toHaveBeenCalledWith(valid);

		// The cap fired at least once with a Parse error envelope.
		const lines = readStdoutLines(stdout);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		expect(JSON.parse(lines[0]!).error.code).toBe(-32700);
	});

	it("rejects oversized frames without buffering them indefinitely", () => {
		const { transport, stdout } = createTransport();
		const onmessage = vi.fn();
		const onerror = vi.fn();
		transport.onmessage = onmessage;
		transport.onerror = onerror;

		// Stream 5 MB of garbage (no newline) in 1 MB chunks. Without the cap this
		// would O(N^2)-copy via Buffer.concat and never finish; with the cap we get
		// one Parse error and the next valid frame still works.
		const oneMb = Buffer.alloc(1024 * 1024, 0x41); // 'A'
		for (let i = 0; i < 5; i++) {
			transport.feedForTest(oneMb);
		}
		const valid = { jsonrpc: "2.0", id: 99, method: "ping" };
		transport.feedForTest(`\n${JSON.stringify(valid)}\n`);

		expect(onerror).toHaveBeenCalled();
		const errs = onerror.mock.calls.map(([e]) => (e as Error).message);
		expect(errs.some((m) => m.includes("exceeded"))).toBe(true);
		expect(onmessage).toHaveBeenCalledWith(valid);
		const lines = readStdoutLines(stdout);
		expect(JSON.parse(lines[0]!).error.code).toBe(-32700);
	});

	it("drops parse-error envelopes while stdout is saturated", () => {
		const { transport, stdout } = createTransport();
		const onerror = vi.fn();
		transport.onerror = onerror;

		// Force the next stdout.write to return false so the transport flips
		// into the saturated state.
		const originalWrite = stdout.write.bind(stdout);
		// biome-ignore lint/suspicious/noExplicitAny: monkey-patch for backpressure simulation
		(stdout as any).write = (chunk: string | Buffer): boolean => {
			originalWrite(chunk);
			return false;
		};

		// First parse error: write happens, returns false, transport saturates.
		transport.feedForTest("garbage1\n");
		const firstLines = readStdoutLines(stdout);
		expect(firstLines).toHaveLength(1);

		// Subsequent parse errors must NOT enqueue more envelopes on stdout
		// while saturated, even though onerror still fires for each one.
		transport.feedForTest("garbage2\n");
		transport.feedForTest("garbage3\n");
		expect(readStdoutLines(stdout)).toHaveLength(0);
		expect(onerror.mock.calls.length).toBeGreaterThanOrEqual(3);
	});

	it("serializes concurrent send() calls so drain listeners do not stack", async () => {
		const { transport, stdout } = createTransport();
		await transport.start();

		// Force backpressure on every write so each send() must wait for drain.
		const writes: string[] = [];
		// biome-ignore lint/suspicious/noExplicitAny: monkey-patch for backpressure simulation
		(stdout as any).write = (chunk: string | Buffer): boolean => {
			writes.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
			return false;
		};

		const peakDrainListeners = { value: 0 };
		const peakCloseListeners = { value: 0 };

		// Issue many concurrent sends. Without serialization each would attach
		// drain/close/error listeners and Node would emit MaxListenersExceededWarning.
		const sends: Array<Promise<void>> = [];
		for (let i = 0; i < 25; i++) {
			sends.push(transport.send({ jsonrpc: "2.0", id: i, result: {} }));
		}

		// Drive the chain forward: each iteration yields, samples the listener
		// counts, then emits drain to unblock the in-flight write.
		while (writes.length < 25) {
			await new Promise((resolve) => setImmediate(resolve));
			peakDrainListeners.value = Math.max(peakDrainListeners.value, stdout.listenerCount("drain"));
			peakCloseListeners.value = Math.max(peakCloseListeners.value, stdout.listenerCount("close"));
			stdout.emit("drain");
		}

		await Promise.all(sends);

		// At most one in-flight write means at most one of each listener type
		// at any sampled moment.
		expect(peakDrainListeners.value).toBeLessThanOrEqual(1);
		expect(peakCloseListeners.value).toBeLessThanOrEqual(1);
		expect(writes).toHaveLength(25);
	});

	it("invokes onclose when stdin ends so the MCP server can shut down", async () => {
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		const transport = new StrictStdioServerTransport(stdin, stdout);
		const onclose = vi.fn();
		transport.onclose = onclose;

		await transport.start();
		stdin.end();
		// Yield the event loop so the 'end' listener fires.
		await new Promise((resolve) => setImmediate(resolve));

		expect(onclose).toHaveBeenCalledOnce();
	});

	it("does not crash when stdout.write throws (e.g. ERR_STREAM_DESTROYED)", () => {
		const { transport, stdout } = createTransport();
		const onerror = vi.fn();
		transport.onerror = onerror;

		// Force the underlying stdout to throw on the next write to mirror the
		// behavior of a destroyed stream. The transport must surface the error via
		// onerror but must not propagate it to the data listener.
		const originalWrite = stdout.write.bind(stdout);
		let writeAttempts = 0;
		// biome-ignore lint/suspicious/noExplicitAny: PassThrough.write monkey-patch for the test
		(stdout as any).write = (chunk: any) => {
			writeAttempts++;
			throw new Error("ERR_STREAM_DESTROYED");
		};

		expect(() => transport.feedForTest("not-json\n")).not.toThrow();
		expect(writeAttempts).toBeGreaterThan(0);
		expect(onerror).toHaveBeenCalled();
		// Restore so the test runner can drain the PassThrough cleanly.
		// biome-ignore lint/suspicious/noExplicitAny: restore the original write
		(stdout as any).write = originalWrite;
	});
});
