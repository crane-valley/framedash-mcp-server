import { type ApiClient, buildBuildComparePath, buildBuildsPath } from "@framedash/api-client";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, projectClient, textResult } from "../helpers.js";
import { ANALYTICS_DAYS, allowedIntEnum } from "./schemas.js";

const days = allowedIntEnum(ANALYTICS_DAYS, "Time period: 7, 14, 30, or 90 days (default 30)");
// Zod's max counts code points; the REST filter limit counts UTF-16 units.
const filter = z
	.string()
	.trim()
	.min(1)
	.max(256)
	.refine(
		(value) => value.length <= 256 && [...value].every((char) => char.charCodeAt(0) >= 32),
		"Use 1-256 characters without control characters",
	);
const projectId = z.string().uuid().optional().describe("Override the default project ID");
const fresh = z
	.boolean()
	.optional()
	.describe(
		"Bypass the aggregation cache (default false); useful when checking newly ingested samples",
	);

export function registerBuildTools(server: McpServer, apiClient: ApiClient): void {
	server.registerTool(
		"list_builds",
		{
			title: "List Builds",
			description:
				"List builds and event/session/player counts. Requires analytics:read. By default returns the newest 50 builds; use build_id for an exact older build. Event counts are not per-metric sample counts or proof that ingestion is complete.",
			annotations: { readOnlyHint: true },
			inputSchema: {
				project_id: projectId,
				days,
				build_id: filter
					.optional()
					.describe("Exact SDK-reported build_id; avoids the newest-50 list cap"),
				fresh,
			},
		},
		async (args) => {
			try {
				const client = projectClient(apiClient, args.project_id);
				return textResult(
					await client.get(
						client.projectPath(
							buildBuildsPath({ days: args.days, buildId: args.build_id, fresh: args.fresh }),
						),
					),
				);
			} catch (err) {
				return errorResult(err);
			}
		},
	);

	server.registerTool(
		"compare_builds",
		{
			title: "Compare Builds",
			description:
				"Compare two builds using the readonly builds/compare API (analytics:read; no SQL/admin access required). Returns P50/P95, sample/session counts and diffs. isRegression reports direction only, not a threshold breach or statistical certainty. Null metrics have an unknown cause; do not infer unsupported SDKs. Verify expected samples and ingestion readiness separately. Unfiltered comparisons include the whole build; map/platform filters change the population. A map filter excludes map_load events, so load_time_ms is unavailable under that filter. For an opt-in CI gate use framedash perf-diff --threshold <pct> --fail-on-regression.",
			annotations: { readOnlyHint: true },
			inputSchema: {
				project_id: projectId,
				baseline: filter.describe("Known-good SDK-reported build_id"),
				candidate: filter.describe("Different SDK-reported build_id to compare"),
				days,
				map_id: filter
					.optional()
					.describe("Restrict to one spatial map_id; excludes map_load samples"),
				platform: filter.optional().describe("Restrict to one platform"),
				fresh,
			},
		},
		async (args) => {
			try {
				if (args.baseline === args.candidate)
					throw new Error("baseline and candidate must be different build IDs");
				const client = projectClient(apiClient, args.project_id);
				return textResult(
					await client.get(
						client.projectPath(
							buildBuildComparePath({
								baseline: args.baseline,
								candidate: args.candidate,
								days: args.days,
								mapId: args.map_id,
								platform: args.platform,
								fresh: args.fresh,
							}),
						),
					),
				);
			} catch (err) {
				return errorResult(err);
			}
		},
	);
}
