import type { ApiClient } from "@framedash/api-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, projectClient, textResult } from "../helpers.js";

export function registerQueryTools(server: McpServer, apiClient: ApiClient): void {
	server.registerTool(
		"query",
		{
			title: "Query Events",
			description:
				"Execute a read-only SQL query against the ClickHouse events table. Returns up to `limit` rows (default 100, max 1000).",
			inputSchema: {
				sql: z.string().describe("SQL query to execute"),
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(1000)
					.optional()
					.describe("Max rows to return (default 100)"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const data = await client.post("/api/v1/query", {
					project_id: client.currentProjectId,
					sql: args.sql,
					limit: args.limit ?? 100,
				});
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);
}
