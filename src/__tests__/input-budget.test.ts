import { randomUUID } from "node:crypto";
import { ApiClient } from "@framedash/api-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../server.js";

describe("tool input budget over JSON-RPC", () => {
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

	beforeEach(async () => {
		vi.spyOn(ApiClient.prototype, "get").mockResolvedValue([]);
		vi.spyOn(ApiClient.prototype, "post").mockResolvedValue([]);
		server = createServer(api, "0.0.0-test");
		client = new Client({ name: "input-budget-test", version: "0.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);
	});

	afterEach(async () => {
		await client.close();
		await server.close();
		vi.restoreAllMocks();
	});

	it("accepts the largest declared input and preserves its API request", async () => {
		const result = await client.callTool({
			name: "get_insights",
			arguments: {
				project_id: "00000000-0000-4000-8000-000000000001",
				metric: "count",
				group_by: "event_name",
				days: 90,
				limit: 50,
				event_name: "level_complete",
			},
		});
		expect(result.isError).not.toBe(true);
		expect(api.get).toHaveBeenCalledWith(
			"/api/v1/projects/00000000-0000-4000-8000-000000000001/insights?metric=count&groupBy=event_name&days=90&limit=50&eventName=level_complete",
		);
	});

	it("accepts exactly 16 members including ignored fields", async () => {
		const result = await client.callTool({
			name: "query",
			arguments: {
				sql: "SELECT 1",
				...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`extra${i}`, null])),
			},
		});
		expect(result.isError).not.toBe(true);
		expect(api.post).toHaveBeenCalledOnce();
	});

	it.each([
		["flat object", Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`extra${i}`, null]))],
		["nested array", { extra: Array(16).fill(null) }],
		[
			"nested object",
			{ extra: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`extra${i}`, null])) },
		],
	])("rejects 17 elements in a %s before calling the API", async (_name, args) => {
		const result = await client.callTool({ name: "list_projects", arguments: args });
		expect(result).toMatchObject({
			isError: true,
			content: [{ type: "text", text: expect.stringContaining("maximum of 16 elements") }],
		});
		expect(api.get).not.toHaveBeenCalled();
		expect(api.post).not.toHaveBeenCalled();
		const recovery = await client.callTool({ name: "list_projects", arguments: {} });
		expect(recovery.isError).not.toBe(true);
		expect(api.get).toHaveBeenCalledOnce();
	});

	it("rejects an oversized invalid scalar before schema validation", async () => {
		const result = await client.callTool({
			name: "query",
			arguments: { sql: Array(16).fill(null) },
		});
		expect(result).toMatchObject({
			isError: true,
			content: [{ text: expect.stringContaining("maximum of 16 elements") }],
		});
		expect(api.post).not.toHaveBeenCalled();
	});

	it("keeps scalar length separate from the element budget", async () => {
		const sql = `SELECT 1 ${" ".repeat(4096)}`;
		const result = await client.callTool({ name: "query", arguments: { sql, limit: 1000 } });
		expect(result.isError).not.toBe(true);
		expect(api.post).toHaveBeenCalledWith("/api/v1/query", {
			project_id: "test-project",
			sql,
			limit: 1000,
		});
	});
});
