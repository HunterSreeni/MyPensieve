import { resolveDefaultModel } from "../config/schema.js";
import { type CompleteFn, runExtraction } from "../memory/extractor.js";
import type { SkillHandler } from "./executor.js";

/**
 * Memory-extract skill.
 * Thin wrapper around runExtraction so the agent can trigger the nightly
 * pipeline on demand via the `dispatch` verb (action="memory.extract").
 *
 * The dispatch verb passes args as `{ action, params, confirm }`. When invoked
 * through dispatch, underscore-prefixed params (test-only hooks) are stripped
 * before being honored - this prevents a remote peer from using them to
 * redirect reads/writes to arbitrary paths.
 *
 * Params (all optional):
 *   all           boolean  - reprocess every session (reset checkpoint)
 *   since         string   - ISO timestamp lower bound
 *   dry_run       boolean  - run without writing to layers/checkpoint
 *   verbose       boolean  - verbose stdout progress
 *
 * Direct-call-only (never honored through dispatch):
 *   _complete, _sessionsDir, _projectsDir
 */
export const memoryExtractHandler: SkillHandler = async (args, ctx) => {
	let model: string;
	try {
		model = resolveDefaultModel(ctx.config);
	} catch (err) {
		return {
			success: false,
			data: null,
			error: err instanceof Error ? err.message : String(err),
		};
	}

	// Detect dispatch-style invocation by the presence of the `action` key at
	// the top level. When present, ignore the raw `params` for test hooks.
	const viaDispatch = typeof args.action === "string";
	const params = viaDispatch ? ((args.params as Record<string, unknown> | undefined) ?? {}) : args;
	const complete = viaDispatch ? undefined : (params._complete as CompleteFn | undefined);
	const sessionsDir =
		!viaDispatch && typeof params._sessionsDir === "string"
			? (params._sessionsDir as string)
			: undefined;
	const projectsDir =
		!viaDispatch && typeof params._projectsDir === "string"
			? (params._projectsDir as string)
			: undefined;

	const result = await runExtraction({
		config: ctx.config,
		model,
		resetCheckpoint: Boolean(params.all),
		since: typeof params.since === "string" ? params.since : undefined,
		dryRun: Boolean(params.dry_run),
		verbose: Boolean(params.verbose),
		sessionsDir,
		projectsDir,
		complete,
	});

	return {
		success: true,
		data: {
			processed_sessions: result.processedSessions,
			skipped_sessions: result.skippedSessions,
			decisions_added: result.decisionsAdded,
			threads_added: result.threadsAdded,
			persona_deltas_added: result.personaDeltasAdded,
			dry_run: result.dryRun,
			failures: result.failures.map((f) => ({ session_path: f.sessionPath, error: f.error })),
		},
	};
};
