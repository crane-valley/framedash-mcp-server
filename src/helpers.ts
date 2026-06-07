import type { ApiClient } from "@framedash/api-client";

const MAX_RESPONSE_SIZE = 50 * 1024; // 50 KB

/** Truncate large responses to protect LLM context windows. */
export function truncate(data: unknown): string {
	const text = JSON.stringify(data, null, 2) ?? "null";
	if (text.length <= MAX_RESPONSE_SIZE) return text;

	if (Array.isArray(data)) {
		const total = data.length;
		for (let keep = Math.min(total, 50); keep > 0; keep--) {
			const slice = JSON.stringify(data.slice(0, keep), null, 2);
			const footer = `\n\n[truncated: showing first ${keep} rows of ${total} total]`;
			if (slice.length + footer.length <= MAX_RESPONSE_SIZE) {
				return slice + footer;
			}
		}
	}
	return `${text.slice(0, MAX_RESPONSE_SIZE)}\n\n[truncated]`;
}

export function textResult(data: unknown) {
	return { content: [{ type: "text" as const, text: truncate(data) }] };
}

/** Extract a human-readable message from an unknown error value. */
export function getErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function errorResult(err: unknown) {
	return {
		content: [{ type: "text" as const, text: getErrorMessage(err) }],
		isError: true as const,
	};
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Create an ApiClient with an optional project_id override. */
export function projectClient(base: ApiClient, overrideProjectId?: string): ApiClient {
	if (!overrideProjectId) return base;
	if (!UUID_RE.test(overrideProjectId)) {
		throw new Error("Invalid project_id: must be a valid UUID");
	}
	return base.withProject(overrideProjectId);
}
