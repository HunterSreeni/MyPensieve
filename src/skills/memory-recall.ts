import type { SkillHandler } from "./executor.js";

/**
 * Memory-recall skill.
 * Thin wrapper around MemoryQuery that backs the `recall` verb.
 */
export const memoryRecallHandler: SkillHandler = async (args, ctx) => {
	const query = args.query as string;
	if (!query) {
		return { success: false, data: null, error: "Missing required arg: query" };
	}

	const layers = args.layers as
		| Array<"decisions" | "threads" | "persona" | "semantic" | "raw">
		| undefined;
	const project = args.project as string | undefined;
	const since = args.since as string | undefined;
	const limit = args.limit as number | undefined;

	const matches = ctx.project.memoryQuery.recall({
		query,
		layers,
		project,
		since,
		limit,
	});

	return {
		success: true,
		data: {
			matches,
			query,
			total: matches.length,
		},
	};
};
