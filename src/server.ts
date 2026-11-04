import type { ApiClient } from "@framedash/api-client";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "./resources.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerProjectTools } from "./tools/project.js";
import { registerQueryTools } from "./tools/query.js";

/**
 * `version` is the handshake version advertised to clients; hosts source it from this package's
 * package.json (the stdio bin reads it with fs at boot, the hosted HTTP endpoint imports the
 * JSON at build time) so it cannot drift from the published package. Keeping the fs read OUT of
 * this module makes it bundler-safe for the Next.js remote endpoint.
 */
export function createServer(apiClient: ApiClient, version: string): McpServer {
	const server = new McpServer(
		{ name: "framedash", version },
		// Current tools need at most six scalar fields; bound validation of extra/nested input too.
		{ maxToolInputElements: 16 },
	);

	registerQueryTools(server, apiClient);
	registerAnalyticsTools(server, apiClient);
	registerProjectTools(server, apiClient);
	registerAlertTools(server, apiClient);
	registerResources(server, apiClient);

	return server;
}
