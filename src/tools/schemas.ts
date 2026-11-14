import { z } from "zod";

export const ANALYTICS_DAYS = [7, 14, 30, 90] as const;

export function allowedIntEnum<T extends number>(
	values: readonly [T, T, ...T[]],
	description: string,
) {
	const literals = values.map((value) => z.literal(value)) as unknown as [
		z.ZodLiteral<T>,
		z.ZodLiteral<T>,
		...z.ZodLiteral<T>[],
	];
	return z.union(literals).optional().describe(description);
}
