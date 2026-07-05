import { describe, expect, it } from "vitest";
import { truncate } from "../helpers.js";

describe("truncate", () => {
	it("returns full arrays that fit inside the response limit", () => {
		const rows = Array.from({ length: 75 }, (_, index) => ({
			id: index,
			name: `row-${index}`,
		}));

		expect(truncate(rows)).toBe(JSON.stringify(rows, null, 2));
	});

	it("returns full arrays of short primitives that fit inside the response limit", () => {
		const rows = Array.from({ length: 6_419 }, () => 0);

		expect(truncate(rows)).toBe(JSON.stringify(rows, null, 2));
	});

	it("honors array-level toJSON before truncating arrays", () => {
		const rows = [{ id: 1, secret: "raw" }] as Array<{ id: number; secret: string }> & {
			toJSON: () => unknown;
		};
		rows.toJSON = () => [{ id: 1, secret: "redacted" }];

		expect(truncate(rows)).toBe(JSON.stringify(rows, null, 2));
	});

	it("passes array indexes to element toJSON when full arrays fit", () => {
		const rows = Array.from({ length: 2 }, (_, index) => ({
			toJSON(key: string) {
				return { index, key };
			},
		}));

		expect(truncate(rows)).toBe(JSON.stringify(rows, null, 2));
	});

	it("does not rerun toJSON on array item replacement values", () => {
		let replacementToJSONCalls = 0;
		const replacement = {
			visible: true,
			toJSON() {
				replacementToJSONCalls++;
				return { hidden: true };
			},
		};
		Object.freeze(replacement);
		const rows = [
			{
				toJSON() {
					return replacement;
				},
			},
		];

		expect(truncate(rows)).toBe(JSON.stringify(rows, null, 2));
		expect(replacementToJSONCalls).toBe(0);
	});

	it("stops serializing rows once a large array must be truncated", () => {
		const serializedRows: number[] = [];
		const rows = Array.from({ length: 1_000 }, (_, index) => ({
			id: index,
			toJSON() {
				serializedRows.push(index);
				return {
					id: index,
					payload: "x".repeat(2_048),
				};
			},
		}));

		const text = truncate(rows);

		expect(text).toContain("[truncated: showing first");
		expect(text.length).toBeLessThanOrEqual(50 * 1024);
		expect(serializedRows.length).toBeLessThan(rows.length);
		expect(new Set(serializedRows).size).toBe(serializedRows.length);
	});

	it("keeps the fallback for a single oversized array row within the response limit", () => {
		const rows = [
			{
				payload: "x".repeat(100 * 1024),
			},
		];

		const text = truncate(rows);

		expect(text).toContain("[truncated]");
		expect(text.length).toBeLessThanOrEqual(50 * 1024);
	});

	it("keeps the fallback for non-array responses within the response limit", () => {
		const text = truncate({ payload: "x".repeat(100 * 1024) });

		expect(text).toContain("[truncated]");
		expect(text.length).toBeLessThanOrEqual(50 * 1024);
	});

	it("stops after the reusable prefix for large arrays below the byte-limit row count", () => {
		const serializedRows: number[] = [];
		const rows = Array.from({ length: 20_000 }, (_, index) => ({
			id: index,
			toJSON() {
				serializedRows.push(index);
				return {
					id: index,
				};
			},
		}));

		const text = truncate(rows);

		expect(text).toContain("[truncated: showing first 50 rows of 20000 total]");
		expect(text.length).toBeLessThanOrEqual(50 * 1024);
		expect(serializedRows).toHaveLength(50);
	});

	it("passes array indexes to element toJSON while building truncated prefixes", () => {
		const rows = Array.from({ length: 1_000 }, (_, index) => ({
			toJSON(key: string) {
				return {
					key,
					payload: `${index}-${"x".repeat(2_048)}`,
				};
			},
		}));

		const text = truncate(rows);

		expect(text).toContain('"key": "0"');
		expect(text).not.toContain('"key": ""');
		expect(text.length).toBeLessThanOrEqual(50 * 1024);
	});

	it("does not skip items in the prefix if a middle item is too large to fit", () => {
		const rows = [
			{ id: 0, payload: "x".repeat(1_000) },
			{ id: 1, payload: "x".repeat(50_132) },
			{ id: 2, payload: "x".repeat(10) },
		];

		const text = truncate(rows);

		expect(text).toContain('"id": 0');
		expect(text).not.toContain('"id": 2');
		expect(text).toContain("[truncated: showing first 1 rows");
	});
});
