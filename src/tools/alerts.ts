import type { ApiClient } from "@framedash/api-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, projectClient, textResult } from "../helpers.js";

export function registerAlertTools(server: McpServer, apiClient: ApiClient): void {
	server.registerTool(
		"list_alerts",
		{
			title: "List Alerts",
			description: "List all alert rules in the project.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const data = await client.get(client.projectPath("alerts"));
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);

	server.registerTool(
		"get_alert_history",
		{
			title: "Get Alert History",
			description: "Get alert event history (trigger/resolve events).",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe("Max events to return (default 50)"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const params = new URLSearchParams();
				if (args.limit) params.set("limit", String(args.limit));
				const qs = params.toString() ? `?${params}` : "";
				const data = await client.get(client.projectPath(`alerts/history${qs}`));
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);
}
