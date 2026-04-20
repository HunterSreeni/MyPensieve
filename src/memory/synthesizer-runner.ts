/**
 * Synthesizer runner - I/O wrapper around the pure synthesizer functions.
 *
 * Loads one or more projects, runs decision de-dup and persona-delta
 * aggregation, and either reports findings (default) or applies them
 * (rewrites decisions.jsonl + marks deltas applied).
 */
import fs from "node:fs";
import path from "node:path";
import { type ProjectState, closeProject, listProjects, loadProject } from "../projects/loader.js";
import { appendJsonl } from "../utils/jsonl.js";
import {
	type DecisionSynthesisResult,
	type PersonaSynthesisResult,
	synthesizeDecisions,
	synthesizePersonaDeltas,
} from "./synthesizer.js";
import type { Decision, PersonaDelta } from "./types.js";

export interface SynthesisRunOptions {
	/** Apply changes (rewrite decisions.jsonl, mark deltas applied). Default false. */
	apply?: boolean;
	/** Limit to a single project binding. Default: all projects. */
	project?: string;
	/** Override projects directory (tests). */
	projectsDir?: string;
}

export interface SynthesisProjectReport {
	binding: string;
	decisions: DecisionSynthesisResult;
	persona: PersonaSynthesisResult;
	applied: boolean;
}

export interface SynthesisRunResult {
	projects_scanned: number;
	total_decisions_before: number;
	total_duplicates_removed: number;
	total_deltas_applied: number;
	per_project: SynthesisProjectReport[];
}

/**
 * Run synthesis across one or more projects.
 *
 * Report-only (`apply: false`):
 *   - Reads decisions and persona deltas from disk
 *   - Returns what WOULD change, without mutating state
 *
 * Apply mode (`apply: true`):
 *   - Atomically rewrites decisions.jsonl with the canonical (de-duped) set
 *   - Marks consumed persona deltas as applied in the SQLite index
 */
export function runSynthesis(opts: SynthesisRunOptions = {}): SynthesisRunResult {
	const bindings = opts.project ? [opts.project] : listProjects(opts.projectsDir);

	const perProject: SynthesisProjectReport[] = [];
	let totalBefore = 0;
	let totalDups = 0;
	let totalApplied = 0;

	for (const binding of bindings) {
		let project: ProjectState | undefined;
		try {
			project = loadProject(binding, opts.projectsDir);
			const decisionsAll = project.decisions.readAll();
			const deltasAll = project.persona.readAll();

			const decisionResult = synthesizeDecisions(decisionsAll);
			const personaResult = synthesizePersonaDeltas(deltasAll);

			totalBefore += decisionsAll.length;
			const duplicateCount = decisionsAll.length - decisionResult.canonical.length;
			totalDups += duplicateCount;

			if (opts.apply) {
				if (duplicateCount > 0) {
					rewriteDecisionsJsonl(project.projectDir, decisionResult.canonical);
				}
				for (const id of personaResult.applied_ids) {
					project.persona.markApplied(id);
				}
				totalApplied += personaResult.applied_ids.length;
			}

			perProject.push({
				binding,
				decisions: decisionResult,
				persona: personaResult,
				applied: !!opts.apply,
			});
		} finally {
			if (project) closeProject(project);
		}
	}

	return {
		projects_scanned: bindings.length,
		total_decisions_before: totalBefore,
		total_duplicates_removed: totalDups,
		total_deltas_applied: totalApplied,
		per_project: perProject,
	};
}

/**
 * Atomically replace decisions.jsonl with the canonical set.
 *
 * Concurrency note: the echo path (scheduler) calls the synthesizer only
 * after the extractor has released its lock, so no overlap occurs there.
 * Running `mypensieve synthesize --apply` manually while a separate
 * `mypensieve extract` is mid-flight could race - any decisions appended
 * between `readAll()` and this rename would be clobbered. Operators should
 * avoid concurrent manual invocations.
 */
function rewriteDecisionsJsonl(projectDir: string, canonical: Decision[]): void {
	const target = path.join(projectDir, "decisions.jsonl");
	const tmp = `${target}.synth.tmp`;
	if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
	for (const d of canonical) appendJsonl(tmp, d);
	fs.renameSync(tmp, target);
}

/** Format a run result into a human-readable text report. */
export function formatSynthesisReport(result: SynthesisRunResult): string {
	const lines: string[] = [];
	lines.push(
		`Synthesis: scanned ${result.projects_scanned} project(s), ${result.total_decisions_before} decision(s), ` +
			`${result.total_duplicates_removed} duplicate(s), ${result.total_deltas_applied} persona delta(s).`,
	);
	for (const p of result.per_project) {
		const dupGroups = p.decisions.duplicates.length;
		const fields = Object.keys(p.persona.by_field).length;
		lines.push(
			`  ${p.binding}: ${p.decisions.canonical.length} canonical, ${dupGroups} dup group(s), ${fields} persona field(s)${p.applied ? " [APPLIED]" : " [report-only]"}`,
		);
	}
	return lines.join("\n");
}

// re-export types Decision/PersonaDelta so the CLI + tests have a single import
export type { Decision, PersonaDelta };
