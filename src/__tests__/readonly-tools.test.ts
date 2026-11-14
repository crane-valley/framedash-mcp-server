import { randomUUID } from "node:crypto";
import { ApiClient } from "@framedash/api-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { truncate } from "../helpers.js";
import { createServer } from "../server.js";

describe("readonly analytics tools over JSON-RPC", () => {
	const api = new ApiClient({
		baseUrl: "http://localhost",
		apiKey: randomUUID(),
		projectId: "test-project",
		onError(error) {
			throw error;
		},
	});
	let server: ReturnType<typeof createServer>;
	let client: Client;
	let lastWireResponseBytes = 0;

	async function connect(queryEnabled = true) {
		server = createServer(api, "0.0.0-test", { queryEnabled });
		client = new Client({ name: "readonly-test", version: "0.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const send = serverTransport.send.bind(serverTransport);
		serverTransport.send = async (message, options) => {
			lastWireResponseBytes = Buffer.byteLength(JSON.stringify(message));
			await send(message, options);
		};
		await server.connect(serverTransport);
		await client.connect(clientTransport);
	}

	beforeEach(() => {
		vi.spyOn(ApiClient.prototype, "get").mockResolvedValue([]);
		vi.spyOn(ApiClient.prototype, "post").mockResolvedValue([]);
	});

	afterEach(async () => {
		await client.close();
		await server.close();
		vi.restoreAllMocks();
	});

	it("advertises the read scope and a usable readonly comparison route", async () => {
		await connect();
		const { tools } = await client.listTools();
		for (const name of ["list_builds", "compare_builds"]) {
			expect(tools.find((tool) => tool.name === name)).toMatchObject({
				description: expect.stringContaining("analytics:read"),
				annotations: { readOnlyHint: true },
			});
		}
		expect(tools.find((tool) => tool.name === "query")?.description).toContain("data:admin");
		expect(
			tools.find((tool) => tool.name === "get_heatmap")?.inputSchema.properties?.days,
		).toMatchObject({
			description: expect.stringContaining("default 30"),
		});
		for (const name of ["list_builds", "compare_builds"]) {
			expect(tools.find((tool) => tool.name === name)?.inputSchema.properties?.days).toEqual(
				tools.find((tool) => tool.name === "get_dashboard")?.inputSchema.properties?.days,
			);
		}
	});

	it("lets OAuth-only hosts omit query without changing the stdio default", async () => {
		await connect(false);
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name)).not.toContain("query");
		expect(tools.map((tool) => tool.name)).toContain("compare_builds");
	});

	it("lists an exact build through the existing public readonly REST path", async () => {
		await connect();
		const rows = [{ build_id: "older/build", event_count: 12 }];
		vi.mocked(api.get).mockResolvedValue(rows);
		const result = await client.callTool({
			name: "list_builds",
			arguments: { build_id: "older/build", days: 7, fresh: true },
		});
		expect(api.get).toHaveBeenCalledWith(
			"/api/v1/projects/test-project/builds?days=7&buildId=older%2Fbuild&fresh=1",
		);
		expect(result.content).toEqual([{ type: "text", text: JSON.stringify(rows, null, 2) }]);
		expect(api.post).not.toHaveBeenCalled();
	});

	it("compares with explicit filters and preserves the public comparison payload", async () => {
		await connect();
		const comparison = {
			baseline: { sample_count: 12 },
			candidate: { sample_count: 11 },
			diffs: [],
		};
		vi.mocked(api.get).mockResolvedValue(comparison);
		const result = await client.callTool({
			name: "compare_builds",
			arguments: {
				baseline: "base",
				candidate: "candidate",
				days: 14,
				map_id: "level",
				platform: "linux",
				fresh: true,
			},
		});
		expect(api.get).toHaveBeenCalledWith(
			"/api/v1/projects/test-project/builds/compare?baseline=base&candidate=candidate&days=14&mapId=level&platform=linux&fresh=1",
		);
		expect(result.content).toEqual([{ type: "text", text: JSON.stringify(comparison, null, 2) }]);
	});

	it("rejects unsupported days and self-comparison before fetching", async () => {
		await connect();
		for (const args of [
			{ baseline: "same", candidate: "same" },
			{ baseline: "a", candidate: "b", days: 1 },
		]) {
			expect(await client.callTool({ name: "compare_builds", arguments: args })).toMatchObject({
				isError: true,
			});
		}
		expect(api.get).not.toHaveBeenCalled();
	});

	it("keeps the REST UTF-16 build-ID limit when Zod max counts Unicode code points", async () => {
		await connect();
		const overUtf16Limit = "😀".repeat(129);
		expect(overUtf16Limit.length).toBe(258);
		expect(z.string().max(256).safeParse(overUtf16Limit).success).toBe(true);
		const rejected = await client.callTool({
			name: "list_builds",
			arguments: { build_id: overUtf16Limit },
		});
		expect(rejected.isError).toBe(true);
		expect(api.get).not.toHaveBeenCalled();
		const accepted = await client.callTool({
			name: "list_builds",
			arguments: { build_id: "😀".repeat(128) },
		});
		expect(accepted.isError).not.toBe(true);
		expect(api.get).toHaveBeenCalledOnce();
	});

	it("returns an API denial without retrying or requesting other credentials", async () => {
		await connect();
		vi.mocked(api.get).mockRejectedValue(new Error("Forbidden: analytics:read required"));
		const result = await client.callTool({
			name: "compare_builds",
			arguments: { baseline: "base", candidate: "candidate" },
		});
		expect(result).toMatchObject({
			isError: true,
			content: [{ type: "text", text: "Forbidden: analytics:read required" }],
		});
		expect(api.get).toHaveBeenCalledOnce();
		expect(api.post).not.toHaveBeenCalled();
	});

	it.each([
		{
			days: undefined,
			appliedDays: 30,
			path: "heatmap?mapId=level&eventName=marker&coordinates=world",
		},
		{
			days: 7,
			appliedDays: 7,
			path: "heatmap?mapId=level&days=7&eventName=marker&coordinates=world",
		},
	])("keeps heatmap text/context aligned with the forwarded REST window ($appliedDays days)", async ({
		days,
		appliedDays,
		path,
	}) => {
		await connect();
		const cells = [{ x: 0, z: 25, avg_mem_vram: null }];
		vi.mocked(api.get).mockResolvedValue(cells);
		const result = await client.callTool({
			name: "get_heatmap",
			arguments: { map_id: "level", event_name: "marker", ...(days === undefined ? {} : { days }) },
		});
		expect(result.content).toEqual([{ type: "text", text: JSON.stringify(cells, null, 2) }]);
		expect(result.structuredContent).toMatchObject({ cells });
		expect(result.structuredContent).toMatchObject({
			context: {
				map_id: "level",
				days: appliedDays,
				cell_size: 25,
				event_name: "marker",
				coordinates: "world",
				up_axis: null,
				null_reason: "unknown",
				units: { avg_memory: "MiB", avg_mem_vram: "MiB", avg_frame_time: "ms" },
			},
		});
		expect(api.get).toHaveBeenCalledOnce();
		expect(api.get).toHaveBeenCalledWith(`/api/v1/projects/test-project/${path}`);
	});

	it("bounds 10,000 numeric heatmap cells to the same legacy subset", async () => {
		await connect();
		const cells = Array.from({ length: 10_000 }, (_, index) => heatmapCell(index));
		vi.mocked(api.get).mockResolvedValue(cells);
		const result = await client.callTool({ name: "get_heatmap", arguments: { map_id: "level" } });
		expect(lastWireResponseBytes).toBeLessThanOrEqual(315_392);
		expect(structuredCells(result)).toHaveLength(50);
		expect(result.content).toEqual([
			{
				type: "text",
				text: `${JSON.stringify(cells.slice(0, 50), null, 2)}\n\n[truncated: showing first 50 rows of 10000 total]`,
			},
		]);
		expect(result.structuredContent).toMatchObject({
			cells: cells.slice(0, 50),
			total: 10_000,
			returned: 50,
			truncated: true,
		});
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(315_392);
	});

	it("keeps all cells when a numeric array just below 50KiB fits, even above 50 rows", async () => {
		await connect();
		const cell = heatmapCell(123456);
		const count = Math.floor((50 * 1024 - 1) / (JSON.stringify([cell], null, 2).length - 1));
		const cells = Array.from({ length: count }, () => ({ ...cell }));
		const legacy = JSON.stringify(cells, null, 2);
		expect(count).toBeGreaterThan(50);
		expect(legacy.length).toBeGreaterThan(50 * 1024 - 1024);
		expect(legacy.length).toBeLessThanOrEqual(50 * 1024);
		vi.mocked(api.get).mockResolvedValue(cells);
		const result = await client.callTool({ name: "get_heatmap", arguments: { map_id: "level" } });
		expect(lastWireResponseBytes).toBeLessThanOrEqual(315_392);
		expect(structuredCells(result)).toHaveLength(count);
		expect(result.content).toEqual([{ type: "text", text: legacy }]);
		expect(result.structuredContent).toMatchObject({
			cells,
			total: count,
			returned: count,
			truncated: false,
		});
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(315_392);
	});

	it("does not expose a partial oversized cell as a complete structured cell", async () => {
		await connect();
		const cells = [{ ...heatmapCell(0), annotation: "x".repeat(100_000) }];
		vi.mocked(api.get).mockResolvedValue(cells);
		const result = await client.callTool({ name: "get_heatmap", arguments: { map_id: "level" } });
		expect(lastWireResponseBytes).toBeLessThanOrEqual(315_392);
		expect(structuredCells(result)).toHaveLength(0);
		expect(result.content).toEqual([{ type: "text", text: truncate(cells) }]);
		expect(result.structuredContent).toMatchObject({
			cells: [],
			total: 1,
			returned: 0,
			truncated: true,
		});
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(315_392);
	});

	it.each(["界", '"\\'])("bounds wire bytes for near-limit %s cell data", async (padding) => {
		await connect();
		const annotation = padding.repeat(padding.length === 1 ? 25_000 : 6_200);
		const cells = Array.from({ length: 2 }, () => ({ ...heatmapCell(0), annotation }));
		vi.mocked(api.get).mockResolvedValue(cells);
		const result = await client.callTool({ name: "get_heatmap", arguments: { map_id: "level" } });
		expect(lastWireResponseBytes).toBeLessThanOrEqual(315_392);
		expect(structuredCells(result)).toHaveLength(2);
		expect(result.content).toEqual([{ type: "text", text: truncate(cells) }]);
		expect(result.structuredContent).toMatchObject({
			cells,
			total: 2,
			returned: 2,
			truncated: false,
		});
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(315_392);
	});

	it("bounds Unicode request metadata independently of cell truncation without changing filters", async () => {
		await connect();
		const eventName = "界".repeat(50_000);
		vi.mocked(api.get).mockResolvedValue([]);
		const result = await client.callTool({
			name: "get_heatmap",
			arguments: { map_id: "level", event_name: eventName },
		});
		expect(lastWireResponseBytes).toBeLessThanOrEqual(315_392);
		expect(
			(result.structuredContent as { context: { event_name: string } }).context.event_name,
		).toHaveLength(256);
		expect(result.structuredContent).toMatchObject({
			cells: [],
			total: 0,
			returned: 0,
			truncated: false,
			context: { event_name: eventName.slice(0, 256), truncated_fields: ["event_name"] },
		});
		expect(api.get).toHaveBeenCalledWith(
			`/api/v1/projects/test-project/heatmap?${new URLSearchParams({ mapId: "level", eventName, coordinates: "world" })}`,
		);
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(315_392);
	});
});

function heatmapCell(index: number) {
	return {
		x: index * 25,
		y: index * 25,
		weight: 123456.789,
		event_count: 123456,
		avg_fps: 123.456,
		avg_frame_time: 16.666,
		avg_memory: 1024.123,
		avg_gpu_time: 12.345,
		avg_mem_vram: 4096.789,
	};
}

function structuredCells(result: unknown): unknown[] {
	return (result as { structuredContent: { cells: unknown[] } }).structuredContent.cells;
}
