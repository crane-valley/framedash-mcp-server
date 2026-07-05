import { ApiClient } from "@framedash/api-client";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "../server.js";

/** Create a mock ApiClient that returns `data` for any request. */
const throwOnError = (err: Error): never => {
	throw err;
};

function mockClient(data: unknown = []): ApiClient {
	const client = new ApiClient({
		baseUrl: "http://localhost",
		apiKey: "test-key",
		projectId: "test-project",
		onError: throwOnError,
	});
	vi.spyOn(client, "get").mockResolvedValue(data);
	vi.spyOn(client, "post").mockResolvedValue(data);
	return client;
}

describe("createServer", () => {
	it("creates a server with 12 tools", () => {
		const server = createServer(mockClient(), "0.0.0-test");
		// Server instance should exist
		expect(server).toBeDefined();
		expect(server.server).toBeDefined();
	});

	it("registers all 12 tools", () => {
		const client = mockClient();
		const server = createServer(client, "0.0.0-test");

		const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
			._registeredTools;
		const toolNames = Object.keys(tools);

		const expectedTools = [
			"query",
			"get_dashboard",
			"get_retention",
			"get_funnel",
			"get_insights",
			"get_heatmap",
			"list_projects",
			"get_project_status",
			"list_maps",
			"list_content",
			"list_alerts",
			"get_alert_history",
		];

		for (const name of expectedTools) {
			expect(toolNames).toContain(name);
		}
		expect(toolNames).toHaveLength(12);
	});

	it("registers 1 static resource and 3 resource templates", () => {
		const server = createServer(mockClient(), "0.0.0-test");

		const resources = Object.keys(
			(server as unknown as { _registeredResources: Record<string, unknown> })._registeredResources,
		);
		expect(resources).toContain("framedash://projects");
		expect(resources).toHaveLength(1);

		const templates = Object.keys(
			(server as unknown as { _registeredResourceTemplates: Record<string, unknown> })
				._registeredResourceTemplates,
		);
		expect(templates).toContain("project-maps");
		expect(templates).toContain("project-content");
		expect(templates).toContain("project-status");
		expect(templates).toHaveLength(3);
	});
});

describe("ApiClient", () => {
	it("builds project paths with encoding", () => {
		const client = new ApiClient({
			baseUrl: "https://example.com",
			apiKey: "key",
			projectId: "proj-123",
			onError: throwOnError,
		});
		expect(client.projectPath("dashboard")).toBe("/api/v1/projects/proj-123/dashboard");
	});

	it("encodes special characters in project ID", () => {
		const client = new ApiClient({
			baseUrl: "https://example.com",
			apiKey: "key",
			projectId: "proj/special",
			onError: throwOnError,
		});
		expect(client.projectPath("maps")).toBe("/api/v1/projects/proj%2Fspecial/maps");
	});

	it("creates new client with withProject", () => {
		const client = new ApiClient({
			baseUrl: "https://example.com",
			apiKey: "key",
			projectId: "proj-1",
			onError: throwOnError,
		});
		const override = client.withProject("proj-2");
		expect(override.projectPath("status")).toBe("/api/v1/projects/proj-2/status");
		// Original unchanged
		expect(client.projectPath("status")).toBe("/api/v1/projects/proj-1/status");
	});
});
