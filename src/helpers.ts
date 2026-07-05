import type { ApiClient } from "@framedash/api-client";

const MAX_RESPONSE_SIZE = 50 * 1024; // 50 KB
const ARRAY_TRUNCATION_ROW_LIMIT = 50;
const ARRAY_OPEN_LENGTH = "[".length;
const ARRAY_CLOSE = "\n]";
const ARRAY_CLOSE_LENGTH = ARRAY_CLOSE.length;
const ARRAY_FIRST_ITEM_SEPARATOR_LENGTH = "\n".length;
const ARRAY_ITEM_SEPARATOR_LENGTH = ",\n".length;
const MIN_STRINGIFIED_ARRAY_ITEM_LENGTH = "  0".length;
const TRUNCATED_FOOTER_PREFIX = "\n\n[truncated: showing first ";
const TRUNCATED_FOOTER_MIDDLE = " rows of ";
const TRUNCATED_FOOTER_SUFFIX = " total]";
const SIMPLE_TRUNCATED_FOOTER = "\n\n[truncated]";
const TRUNCATED_FOOTER_STATIC_LENGTH =
	TRUNCATED_FOOTER_PREFIX.length + TRUNCATED_FOOTER_MIDDLE.length + TRUNCATED_FOOTER_SUFFIX.length;
const FALLBACK_KEEP_LENGTH = Math.max(0, MAX_RESPONSE_SIZE - SIMPLE_TRUNCATED_FOOTER.length);

function applyArrayItemToJSON(value: unknown, index: number): unknown {
	if (value == null || (typeof value !== "object" && typeof value !== "function")) return value;

	const toJSON = (value as { toJSON?: unknown }).toJSON;
	if (typeof toJSON !== "function") return value;

	return toJSON.call(value, String(index));
}

function createArraySlotProxy(source: object): object {
	const proxyTarget = Array.isArray(source) ? new Array(source.length) : {};

	return new Proxy(proxyTarget, {
		get(target, prop) {
			if (prop === "toJSON") return undefined;
			if (prop === "length" && Array.isArray(target)) return target.length;
			return Reflect.get(source, prop, source);
		},
		getOwnPropertyDescriptor(target, prop) {
			if (prop === "toJSON") return undefined;
			if (prop === "length" && Array.isArray(target)) {
				return Reflect.getOwnPropertyDescriptor(target, prop);
			}

			const descriptor = Reflect.getOwnPropertyDescriptor(source, prop);
			if (!descriptor) return undefined;

			return { ...descriptor, configurable: true };
		},
		ownKeys(target) {
			const keys = new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(source)]);
			keys.delete("toJSON");
			return [...keys];
		},
	});
}

function stringifyArraySlotValue(value: unknown): string {
	if (value === undefined || typeof value === "function" || typeof value === "symbol")
		return "null";
	if (value == null || (typeof value !== "object" && typeof value !== "function")) {
		return JSON.stringify(value, null, 2) ?? "null";
	}

	const target = value as { toJSON?: unknown };
	if (typeof target.toJSON !== "function") return JSON.stringify(value, null, 2) ?? "null";

	return JSON.stringify(createArraySlotProxy(value), null, 2) ?? "null";
}

function stringifyArrayItem(value: unknown, index: number): string {
	const text = stringifyArraySlotValue(applyArrayItemToJSON(value, index));
	return text.replace(/^/gm, "  ");
}

function truncatedArrayFooterLength(keep: number, total: number): number {
	return TRUNCATED_FOOTER_STATIC_LENGTH + String(keep).length + String(total).length;
}

function truncatedArrayFooter(keep: number, total: number): string {
	return `${TRUNCATED_FOOTER_PREFIX}${keep}${TRUNCATED_FOOTER_MIDDLE}${total}${TRUNCATED_FOOTER_SUFFIX}`;
}

function minimumFullArrayLength(fullLength: number, currentIndex: number, total: number): number {
	const remainingItems = Math.max(0, total - currentIndex);
	if (remainingItems === 0) return fullLength + ARRAY_CLOSE_LENGTH;

	const firstSeparatorLength =
		currentIndex === 0 ? ARRAY_FIRST_ITEM_SEPARATOR_LENGTH : ARRAY_ITEM_SEPARATOR_LENGTH;

	return (
		fullLength +
		firstSeparatorLength +
		MIN_STRINGIFIED_ARRAY_ITEM_LENGTH +
		(remainingItems - 1) * (ARRAY_ITEM_SEPARATOR_LENGTH + MIN_STRINGIFIED_ARRAY_ITEM_LENGTH) +
		ARRAY_CLOSE_LENGTH
	);
}

function truncateArrayFallback(firstItem: string): string {
	const text = `[\n${firstItem}`;
	return `${text.slice(0, FALLBACK_KEEP_LENGTH)}${SIMPLE_TRUNCATED_FOOTER}`;
}

function stringifyArrayForResponse(data: unknown[]): string {
	if (data.length === 0) return "[]";

	const fullParts = ["["];
	const prefixParts = ["["];
	let fullLength = ARRAY_OPEN_LENGTH;
	let prefixLength = ARRAY_OPEN_LENGTH;
	let prefixKeep = 0;
	let firstItem = "";
	let canAppendToPrefix = true;

	const total = data.length;

	for (let i = 0; i < total; i++) {
		const cannotFitFullArray =
			(i >= ARRAY_TRUNCATION_ROW_LIMIT || !canAppendToPrefix) &&
			minimumFullArrayLength(fullLength, i, total) > MAX_RESPONSE_SIZE;
		if (cannotFitFullArray) {
			if (prefixKeep > 0) {
				prefixParts.push(ARRAY_CLOSE);
				return `${prefixParts.join("")}${truncatedArrayFooter(prefixKeep, total)}`;
			}
			return truncateArrayFallback(firstItem);
		}

		const separator = i === 0 ? "\n" : ",\n";
		const item = stringifyArrayItem(data[i], i);
		if (i === 0) firstItem = item;

		if (canAppendToPrefix && i < ARRAY_TRUNCATION_ROW_LIMIT) {
			const nextKeep = i + 1;
			const nextPrefixLength =
				prefixLength +
				separator.length +
				item.length +
				ARRAY_CLOSE_LENGTH +
				truncatedArrayFooterLength(nextKeep, total);
			if (nextPrefixLength <= MAX_RESPONSE_SIZE) {
				prefixParts.push(separator, item);
				prefixLength += separator.length + item.length;
				prefixKeep = nextKeep;
			} else {
				canAppendToPrefix = false;
			}
		}

		const nextFullLength = fullLength + separator.length + item.length + ARRAY_CLOSE_LENGTH;
		if (nextFullLength > MAX_RESPONSE_SIZE) {
			if (prefixKeep > 0) {
				prefixParts.push(ARRAY_CLOSE);
				return `${prefixParts.join("")}${truncatedArrayFooter(prefixKeep, total)}`;
			}
			return truncateArrayFallback(firstItem);
		}

		fullParts.push(separator, item);
		fullLength += separator.length + item.length;
	}

	fullParts.push(ARRAY_CLOSE);
	return fullParts.join("");
}

function stringifyAndTruncate(data: unknown): string {
	const text = JSON.stringify(data, null, 2) ?? "null";
	if (text.length <= MAX_RESPONSE_SIZE) return text;

	return `${text.slice(0, FALLBACK_KEEP_LENGTH)}${SIMPLE_TRUNCATED_FOOTER}`;
}

/** Truncate large responses to protect LLM context windows. */
export function truncate(data: unknown): string {
	if (Array.isArray(data) && typeof (data as { toJSON?: unknown }).toJSON !== "function") {
		return stringifyArrayForResponse(data);
	}

	return stringifyAndTruncate(data);
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
