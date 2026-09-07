/**
 * Thin fetch helpers shared by resources.ts and tools/project.ts so each
 * endpoint path is defined in exactly one place.
 *
 * The fetchProject* helpers hit project-scoped routes via
 * ApiClient.projectPath(); fetchContent hits the global /api/v1/content
 * list (path built by the api-client buildContentPath builder) -- pass a
 * projectClient-derived client to scope it via the X-Project-Id header.
 */
import { type ApiClient, buildContentPath } from "@framedash/api-client";

export async function fetchProjectStatus(client: ApiClient): Promise<unknown> {
	return client.get(client.projectPath("status"));
}

export async function fetchProjectMaps(client: ApiClient): Promise<unknown> {
	return client.get(client.projectPath("maps"));
}

export async function fetchProjectContent(client: ApiClient): Promise<unknown> {
	return client.get(client.projectPath("content"));
}

export async function fetchContent(
	apiClient: ApiClient,
	opts: { type?: string } = {},
): Promise<unknown> {
	return apiClient.get(buildContentPath(opts));
}
