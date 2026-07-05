import type { ApiClient } from "@framedash/api-client";
import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchProjectContent, fetchProjectMaps, fetchProjectStatus } from "./api.js";
import { getErrorMessage, projectClient, truncate } from "./helpers.js";

export function registerResources(server: McpServer, apiClient: ApiClient): void {
	server.registerResource(
		"projects",
		"framedash://projects",
		{
			title: "Projects",
			description: "Project bound to the current API key",
			mimeType: "application/json",
		},
		async () => {
			try {
				const data = await apiClient.get("/api/v1/projects");
				return { contents: [{ uri: "framedash://projects", text: truncate(data) }] };
			} catch (err) {
				const msg = getErrorMessage(err);
				return { contents: [{ uri: "framedash://projects", text: msg }] };
			}
		},
	);

	server.registerResource(
		"project-maps",
		new ResourceTemplate("framedash://projects/{projectId}/maps", { list: undefined }),
		{
			title: "Project Maps",
			description: "Maps in a project with coordinates",
			mimeType: "application/json",
		},
		async (uri, params) => {
			try {
				const client = projectClient(apiClient, String(params.projectId));
				const data = await fetchProjectMaps(client);
				return { contents: [{ uri: uri.href, text: truncate(data) }] };
			} catch (err) {
				const msg = getErrorMessage(err);
				return { contents: [{ uri: uri.href, text: msg }] };
			}
		},
	);

	server.registerResource(
		"project-content",
		new ResourceTemplate("framedash://projects/{projectId}/content", { list: undefined }),
		{
			title: "Content Registry",
			description: "Content entries (event names, display labels)",
			mimeType: "application/json",
		},
		async (uri, params) => {
			try {
				const client = projectClient(apiClient, String(params.projectId));
				const data = await fetchProjectContent(client);
				return { contents: [{ uri: uri.href, text: truncate(data) }] };
			} catch (err) {
				const msg = getErrorMessage(err);
				return { contents: [{ uri: uri.href, text: msg }] };
			}
		},
	);

	server.registerResource(
		"project-status",
		new ResourceTemplate("framedash://projects/{projectId}/status", { list: undefined }),
		{
			title: "Project Status",
			description: "Project status and event statistics",
			mimeType: "application/json",
		},
		async (uri, params) => {
			try {
				const client = projectClient(apiClient, String(params.projectId));
				const data = await fetchProjectStatus(client);
				return { contents: [{ uri: uri.href, text: truncate(data) }] };
			} catch (err) {
				const msg = getErrorMessage(err);
				return { contents: [{ uri: uri.href, text: msg }] };
			}
		},
	);
}
