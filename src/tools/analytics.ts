import type { ApiClient } from "@framedash/api-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, projectClient, textResult } from "../helpers.js";

// The REST API rejects values outside these sets with HTTP 400. They mirror the
// web app's constants (ALLOWED_DAYS / ALLOWED_LIMITS in lib/analytics/constants,
// VALID_DAYS / VALID_CELL_SIZES in lib/heatmap-constants). The MCP server is a
// separate package and cannot import them, so keep these in sync if the API changes.
// Constraining the input schema lets the MCP client reject invalid values up front
// instead of after a server round-trip.
const ANALYTICS_DAYS = [7, 14, 30, 90] as const;
const INSIGHTS_LIMITS = [10, 20, 50] as const;
const HEATMAP_DAYS = [1, 7, 14, 30] as const;
const HEATMAP_CELL_SIZES = [5, 10, 25, 50] as const;

/**
 * Optional value constrained to an allowed set, mirroring the REST API. Built from
 * z.union(z.literal(...)) rather than z.number().refine(...) so the allowed values
 * serialize into the JSON Schema the MCP SDK publishes -- `refine` runs opaque JS
 * and is dropped by the schema converter, which would leave the LLM unable to see
 * the constraint and reject out-of-set values before a server round-trip.
 */
function allowedIntEnum<T extends number>(values: readonly [T, T, ...T[]], description: string) {
	const literals = values.map((v) => z.literal(v)) as unknown as [
		z.ZodLiteral<T>,
		z.ZodLiteral<T>,
		...z.ZodLiteral<T>[],
	];
	return z.union(literals).optional().describe(description);
}

export function registerAnalyticsTools(server: McpServer, apiClient: ApiClient): void {
	server.registerTool(
		"get_dashboard",
		{
			title: "Get Dashboard",
			description: "Get project dashboard metrics (KPIs, daily active users, top events).",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				days: allowedIntEnum(ANALYTICS_DAYS, "Time period: 7, 14, 30, or 90 days (default 30)"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const params = new URLSearchParams();
				if (args.days) params.set("days", String(args.days));
				const qs = params.toString() ? `?${params}` : "";
				const data = await client.get(client.projectPath(`dashboard${qs}`));
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);

	server.registerTool(
		"get_retention",
		{
			title: "Get Retention",
			description: "Get player retention cohort analysis.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				days: allowedIntEnum(ANALYTICS_DAYS, "Time period: 7, 14, 30, or 90 days (default 30)"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const params = new URLSearchParams();
				if (args.days) params.set("days", String(args.days));
				const qs = params.toString() ? `?${params}` : "";
				const data = await client.get(client.projectPath(`retention${qs}`));
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);

	server.registerTool(
		"get_funnel",
		{
			title: "Get Funnel",
			description: "Analyze event funnels. Requires 2-8 event names as steps.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				steps: z.string().describe("Comma-separated event names (2-8 steps)"),
				days: allowedIntEnum(ANALYTICS_DAYS, "Time period: 7, 14, 30, or 90 days (default 30)"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const params = new URLSearchParams({ steps: args.steps });
				if (args.days) params.set("days", String(args.days));
				const data = await client.get(client.projectPath(`funnels?${params}`));
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);

	server.registerTool(
		"get_insights",
		{
			title: "Get Insights",
			description: "Get aggregated insights for a metric grouped by a dimension.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				metric: z.string().describe("Metric to aggregate: count or unique_players"),
				group_by: z.string().describe("Dimension to group by (e.g. event_name, platform)"),
				days: allowedIntEnum(ANALYTICS_DAYS, "Time period: 7, 14, 30, or 90 days (default 30)"),
				limit: allowedIntEnum(INSIGHTS_LIMITS, "Max groups to return: 10, 20, or 50"),
				event_name: z.string().optional().describe("Filter by event name"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const params = new URLSearchParams({
					metric: args.metric,
					groupBy: args.group_by,
				});
				if (args.days) params.set("days", String(args.days));
				if (args.limit) params.set("limit", String(args.limit));
				if (args.event_name) params.set("eventName", args.event_name);
				const data = await client.get(client.projectPath(`insights?${params}`));
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);

	server.registerTool(
		"get_heatmap",
		{
			title: "Get Heatmap",
			description: "Get heatmap grid data for a map. Returns performance metrics per cell.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				map_id: z
					.string()
					.describe("Map ID to query (accepts the row UUID or slug from list_maps)"),
				cell_size: allowedIntEnum(HEATMAP_CELL_SIZES, "Cell size: 5, 10, 25, or 50 (default 25)"),
				days: allowedIntEnum(HEATMAP_DAYS, "Time period: 1, 7, 14, or 30 days (default 7)"),
				event_name: z.string().optional().describe("Filter by event name"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const params = new URLSearchParams({ mapId: args.map_id });
				if (args.cell_size) params.set("cellSize", String(args.cell_size));
				if (args.days) params.set("days", String(args.days));
				if (args.event_name) params.set("eventName", args.event_name);
				const data = await client.get(client.projectPath(`heatmap?${params}`));
				return textResult(data);
			} catch (err) {
				return errorResult(err);
			}
		},
	);
}
