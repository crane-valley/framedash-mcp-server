import type { ApiClient } from "@framedash/api-client";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "./resources.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerProjectTools } from "./tools/project.js";
import { registerQueryTools } from "./tools/query.js";

export function createServer(apiClient: ApiClient): McpServer {
	const server = new McpServer({
		name: "framedash",
		version: "0.1.0",
	});

	registerQueryTools(server, apiClient);
	registerAnalyticsTools(server, apiClient);
	registerProjectTools(server, apiClient);
	registerAlertTools(server, apiClient);
	registerResources(server, apiClient);

	return server;
}
