import type { ApiClient } from "@framedash/api-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchContent, fetchProjectMaps, fetchProjectStatus } from "../api.js";
import { errorResult, projectClient, textResult } from "../helpers.js";

export function registerProjectTools(server: McpServer, apiClient: ApiClient): void {
	server.registerTool(
		"list_projects",
		{
			title: "List Projects",
			description: "List projects accessible to the current credential. Requires analytics:read.",
		},
		async () => {
			try {
				const data = await apiClient.get("/api/v1/projects");
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);

	server.registerTool(
		"get_project_status",
		{
			title: "Get Project Status",
			description:
				"Get the status of a project (event counts, last event time, etc.). Requires analytics:read.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const data = await fetchProjectStatus(client);
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);

	server.registerTool(
		"list_maps",
		{
			title: "List Maps",
			description:
				"List all maps in the project, including upAxis and bounds for interpreting heatmap coordinates. Requires analytics:read.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const data = await fetchProjectMaps(client);
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);

	server.registerTool(
		"list_content",
		{
			title: "List Content",
			description:
				"List content registry entries (event names, display labels, etc.). Requires analytics:read.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				type: z.string().optional().describe("Filter by content type"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const data = await fetchContent(client, { type: args.type });
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);
}
