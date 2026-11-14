import {
	type ApiClient,
	buildDashboardPath,
	buildFunnelPath,
	buildHeatmapPath,
	buildInsightsPath,
	buildRetentionPath,
} from "@framedash/api-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, projectClient, structuredArrayResult, textResult } from "../helpers.js";
import { ANALYTICS_DAYS, allowedIntEnum } from "./schemas.js";

// The REST API rejects values outside these sets with HTTP 400. They mirror the
// web app's constants (ALLOWED_DAYS / ALLOWED_LIMITS in lib/analytics/constants,
// ALLOWED_WINDOW_SECONDS in the funnels route, VALID_DAYS / VALID_CELL_SIZES in
// lib/heatmap-constants). The MCP server is a separate package and cannot import
// them, so keep these in sync if the API changes. Constraining the input schema
// lets the MCP client reject invalid values up front instead of after a server
// round-trip.
const INSIGHTS_LIMITS = [10, 20, 50] as const;
const FUNNEL_WINDOWS = [3600, 21600, 86400, 604800] as const;
const HEATMAP_DAYS = [1, 7, 14, 30] as const;
const HEATMAP_CELL_SIZES = [5, 10, 25, 50] as const;
const CONTEXT_FIELD_LIMIT = 256;

export function registerAnalyticsTools(server: McpServer, apiClient: ApiClient): void {
	server.registerTool(
		"get_dashboard",
		{
			title: "Get Dashboard",
			description:
				"Get project dashboard metrics (KPIs, daily active users, top events). Requires analytics:read.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				days: allowedIntEnum(ANALYTICS_DAYS, "Time period: 7, 14, 30, or 90 days (default 30)"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const data = await client.get(client.projectPath(buildDashboardPath({ days: args.days })));
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
			description: "Get player retention cohort analysis. Requires analytics:read.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				days: allowedIntEnum(ANALYTICS_DAYS, "Time period: 7, 14, 30, or 90 days (default 30)"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const data = await client.get(client.projectPath(buildRetentionPath({ days: args.days })));
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
			description: "Analyze event funnels. Requires analytics:read and 2-8 event names as steps.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				steps: z.string().describe("Comma-separated event names (2-8 steps)"),
				days: allowedIntEnum(ANALYTICS_DAYS, "Time period: 7, 14, 30, or 90 days (default 30)"),
				window: allowedIntEnum(
					FUNNEL_WINDOWS,
					"Conversion window in seconds: 3600, 21600, 86400, or 604800 (default 86400)",
				),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const data = await client.get(
					client.projectPath(
						buildFunnelPath({ steps: args.steps, days: args.days, window: args.window }),
					),
				);
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
			description:
				"Get aggregated insights for a metric grouped by a dimension. Requires analytics:read. Results are the top groups, not an exact-build event breakdown; use list_builds/compare_builds for readonly build comparisons.",
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
				const data = await client.get(
					client.projectPath(
						buildInsightsPath({
							metric: args.metric,
							groupBy: args.group_by,
							days: args.days,
							limit: args.limit,
							eventName: args.event_name,
						}),
					),
				);
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
			description:
				"Get heatmap grid data for a map (analytics:read). Legacy text is unchanged; structuredContent.cells contains the same complete cell subset, with total/returned/truncated describing response truncation, not ingestion readiness. Context filter strings are prefixes when listed in context.truncated_fields. Coordinates and cell_size use engine world units, not image pixels. Consult list_maps for upAxis/bounds: Y-up maps (Unity, Godot) use x/z and omit y; otherwise x/y. Null metric causes are unknown.",
			inputSchema: {
				project_id: z.string().uuid().optional().describe("Override the default project ID"),
				map_id: z
					.string()
					.describe("Map ID to query (accepts the row UUID or slug from list_maps)"),
				cell_size: allowedIntEnum(HEATMAP_CELL_SIZES, "Cell size: 5, 10, 25, or 50 (default 25)"),
				days: allowedIntEnum(HEATMAP_DAYS, "Time period: 1, 7, 14, or 30 days (default 30)"),
				event_name: z.string().optional().describe("Filter by event name"),
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				const data = await client.get(
					client.projectPath(
						buildHeatmapPath({
							mapId: args.map_id,
							cellSize: args.cell_size,
							days: args.days,
							eventName: args.event_name,
							coordinates: "world",
						}),
					),
				);
				const result = structuredArrayResult(data);
				const filters = {
					project_id: client.currentProjectId,
					map_id: args.map_id,
					event_name: args.event_name || null,
				};
				const truncatedFields = Object.entries(filters)
					.filter(([, value]) => value !== null && value.length > CONTEXT_FIELD_LIMIT)
					.map(([field]) => field);
				return {
					...result,
					structuredContent: {
						...result.structuredContent,
						context: {
							...Object.fromEntries(
								Object.entries(filters).map(([field, value]) => [
									field,
									value?.slice(0, CONTEXT_FIELD_LIMIT) ?? null,
								]),
							),
							truncated_fields: truncatedFields,
							days: args.days ?? 30,
							cell_size: args.cell_size ?? 25,
							coordinates: "world",
							up_axis: null,
							axis_source: "list_maps.upAxis",
							units: {
								coordinates: "engine world units",
								cell_size: "engine world units",
								weight: "events",
								event_count: "events",
								avg_fps: "frames/s",
								avg_frame_time: "ms",
								avg_gpu_time: "ms",
								avg_memory: "MiB",
								avg_mem_vram: "MiB",
							},
							null_reason: "unknown",
						},
					},
				};
			} catch (err) {
				return errorResult(err);
			}
		},
	);
}
