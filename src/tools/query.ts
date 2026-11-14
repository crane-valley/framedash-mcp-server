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
				"Execute SELECT-only SQL against the ClickHouse events table. Requires an API key with data:admin; analytics:read alone and OAuth tokens cannot use this tool. For readonly access use list_builds, compare_builds, or get_insights instead; do not request elevated credentials for those tasks. Returns up to limit rows (default 100, max 1000).",
			annotations: { readOnlyHint: true },
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
