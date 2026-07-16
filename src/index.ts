#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { ApiClient } from "@framedash/api-client";
import { createServer } from "./server.js";
import { StrictStdioServerTransport } from "./transport.js";

// Source the handshake version from package.json (same approach as the CLI) so
// the advertised server version cannot drift from the published package.
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
	.version as string;

const apiKey = process.env.FRAMEDASH_API_KEY;
if (!apiKey) {
	process.stderr.write(
		"Error: FRAMEDASH_API_KEY environment variable is required. Create an API key on your project's API Keys page at https://app.framedash.dev and set FRAMEDASH_API_KEY. Docs: https://docs.framedash.dev\n",
	);
	process.exit(1);
}

const projectId = process.env.FRAMEDASH_PROJECT_ID ?? "";
if (!projectId) {
	process.stderr.write(
		"Warning: FRAMEDASH_PROJECT_ID is not set. Project-scoped tools will require a project_id argument.\n",
	);
}
const baseUrl = process.env.FRAMEDASH_BASE_URL || "https://app.framedash.dev";

try {
	const client = new ApiClient({
		baseUrl,
		apiKey,
		projectId,
		onError(err) {
			throw err;
		},
	});
	const server = createServer(client, VERSION);
	const transport = new StrictStdioServerTransport();
	await server.connect(transport);
} catch (err) {
	process.stderr.write(`Failed to start MCP server: ${err}\n`);
	process.exit(1);
}
