import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../config/paths.js";
import { parseModelString, resolveDefaultModel } from "../config/schema.js";
import type { Config } from "../config/schema.js";
import { getProjectBinding } from "../core/session.js";
import { captureError } from "../ops/index.js";
import { type ProjectState, closeProject, loadProject } from "../projects/loader.js";
import { ollamaComplete } from "../providers/ollama-complete.js";
import { CheckpointManager } from "./checkpoint.js";
import { type NormalizedSession, listSessionFiles, normalizeSession } from "./session-reader.js";
import type { ExtractionResult, ExtractorCheckpoint } from "./types.js";

/**
 * Function signature for a chat completion. Injectable so tests can stub
 * the LLM without standing up an Ollama mock server.
 */
export type CompleteFn = (args: {
	model: string;
	system: string;
	prompt: string;
}) => Promise<{ ok: boolean; text: string; error?: string }>;

export interface RunExtractionOptions {
	/** Loaded config (provides model + cron). Required unless `model` is supplied. */
	config?: Config;
	/** Override: explicit model id (e.g. "ollama/llama3.1"). Wins over config. */
	model?: string;
	/** Override: where Pi sessions live. Useful for tests. */
	sessionsDir?: string;
	/** Override: where MyPensieve projects live. Useful for tests. */
	projectsDir?: string;
	/** Reset checkpoint and re-process every session. */
	resetCheckpoint?: boolean;
	/** Process sessions started after this ISO timestamp (inclusive). Wins over checkpoint. */
	since?: string;
	/** When true, run extraction but do not write to layers/checkpoint. */
	dryRun?: boolean;
	/** When true, write detailed progress to stdout. */
	verbose?: boolean;
	/** Inject a custom completion function. Defaults to ollamaComplete. */
	complete?: CompleteFn;
}

export interface RunExtractionResult {
	processedSessions: number;
	skippedSessions: number;
	decisionsAdded: number;
	threadsAdded: number;
	personaDeltasAdded: number;
	dryRun: boolean;
	failures: Array<{ sessionPath: string; error: string }>;
}

/** System prompt instructing the model to emit a strict JSON ExtractionResult. */
const EXTRACTOR_SYSTEM_PROMPT = `You are MyPensieve's memory extractor. Read a chat-session transcript and distill it into structured memory records.

Return ONLY a JSON object matching this exact schema:
{
  "decisions": [
    { "content": "<short statement of decision and rationale>", "tags": ["optional", "tags"] }
  ],
  "thread_updates": [
    { "title": "<short topic title>", "summary": "<one-paragraph summary>" }
  ],
  "persona_deltas": [
    { "field": "<persona field name e.g. communication_style|preferences|tools>", "delta_type": "add"|"update"|"contradict", "content": "<observation about the operator>" }
  ]
}

Rules:
- Only emit a decision when the operator clearly chose between options or set a direction. Skip questions, brainstorming, and code reading.
- Only emit a thread when there is a coherent topic spanning multiple turns.
- Only emit a persona delta when the operator reveals a stable preference, working style, or constraint.
- Be conservative. Empty arrays are valid and preferred over noise.
- Output MUST be valid JSON. Do not wrap in markdown fences or commentary.`;

/**
 * Main entry point. Reads new Pi sessions since the last checkpoint,
 * asks the configured LLM to distill each into decisions/threads/persona deltas,
 * and writes them to the appropriate project's layers.
 */
export async function runExtraction(opts: RunExtractionOptions = {}): Promise<RunExtractionResult> {
	const model = opts.model ?? (opts.config ? resolveDefaultModel(opts.config) : undefined);
	if (!model) {
		throw new Error("runExtraction: no model provided. Pass `config` or `model`.");
	}
	const { provider, modelId } = parseModelString(model);
	if (provider !== "ollama" && !opts.complete) {
		throw new Error(
			`runExtraction: provider '${provider}' is not yet supported by the extractor. Only 'ollama' is wired in v0.1.x. Pass an explicit \`complete\` function to override.`,
		);
	}

	const complete: CompleteFn =
		opts.complete ??
		(async (a) => {
			const r = await ollamaComplete({
				model: a.model,
				system: a.system,
				prompt: a.prompt,
				json: true,
			});
			return { ok: r.ok, text: r.text, error: r.error };
		});

	const result: RunExtractionResult = {
		processedSessions: 0,
		skippedSessions: 0,
		decisionsAdded: 0,
		threadsAdded: 0,
		personaDeltasAdded: 0,
		dryRun: !!opts.dryRun,
		failures: [],
	};

	// Cache project handles by binding so we don't re-open SQLite per session.
	const projectCache = new Map<string, ProjectState>();
	const getProject = (binding: string): ProjectState => {
		const existing = projectCache.get(binding);
		if (existing) return existing;
		const p = loadProject(binding, opts.projectsDir);
		projectCache.set(binding, p);
		return p;
	};

	// Acquire an exclusive lock so two concurrent runs (manual + nightly timer,
	// or two remote triggers) cannot process the same sessions twice and emit
	// duplicate records. The lock is a pidfile whose presence blocks rivals.
	const release = acquireExtractorLock(opts.projectsDir);
	if (!release) {
		return {
			...result,
			failures: [
				{
					sessionPath: "<lock>",
					error: "another extractor run is already in progress",
				},
			],
		};
	}

	try {
		// Determine `since` boundary: explicit > checkpoint > none.
		let since = opts.since;
		if (!since && !opts.resetCheckpoint) {
			// Use a single anchor checkpoint at the projects-dir root so we don't
			// re-process the same Pi session for every binding.
			const anchor = getAnchorCheckpoint(opts.projectsDir);
			if (anchor && !opts.resetCheckpoint) since = anchor.last_processed_timestamp;
		}

		const files = listSessionFiles(since, opts.sessionsDir);
		if (opts.verbose) {
			console.log(
				`[extractor] ${files.length} session file(s) to process (since=${since ?? "beginning"}).`,
			);
		}

		let lastTimestamp = since ?? "";
		let lastSessionId = "";

		for (const file of files) {
			const session = normalizeSession(file);
			if (!session || session.messageCount === 0) {
				result.skippedSessions++;
				continue;
			}

			const binding = getProjectBinding("cli", session.cwd || "unknown");
			const projectName = binding;

			let extracted: ExtractionResult;
			try {
				extracted = await extractFromSession({
					session,
					model: modelId,
					complete,
					projectName,
				});
			} catch (err) {
				const e = err instanceof Error ? err : new Error(String(err));
				captureError({
					severity: "medium",
					errorType: "extractor_session_failed",
					errorSrc: "memory:extractor",
					message: e.message,
					context: { sessionPath: file, sessionId: session.sessionId },
				});
				result.failures.push({ sessionPath: file, error: e.message });
				continue;
			}

			if (!opts.dryRun) {
				const project = getProject(binding);
				const counts = persistExtraction(project, extracted, session, projectName);
				result.decisionsAdded += counts.decisions;
				result.threadsAdded += counts.threads;
				result.personaDeltasAdded += counts.personaDeltas;
			} else {
				result.decisionsAdded += extracted.decisions.length;
				result.threadsAdded += extracted.thread_updates.length;
				result.personaDeltasAdded += extracted.persona_deltas.length;
			}

			result.processedSessions++;
			lastTimestamp = session.startedAt;
			lastSessionId = session.sessionId;

			if (opts.verbose) {
				console.log(
					`[extractor] ${session.sessionId} → ${extracted.decisions.length}d / ${extracted.thread_updates.length}t / ${extracted.persona_deltas.length}pd`,
				);
			}
		}

		// Advance the anchor checkpoint when we made progress and aren't dry-running.
		if (!opts.dryRun && result.processedSessions > 0) {
			writeAnchorCheckpoint(
				{
					last_processed_session_id: lastSessionId,
					last_processed_timestamp: lastTimestamp,
					total_sessions_processed: result.processedSessions,
					last_run_status: result.failures.length === 0 ? "success" : "partial",
					last_run_error: result.failures[0]?.error,
				},
				opts.projectsDir,
			);
		}
	} finally {
		for (const p of projectCache.values()) closeProject(p);
		release();
	}

	return result;
}

// --- Concurrency lock --------------------------------------------------------

function lockPath(projectsDir?: string): string {
	const base = projectsDir ?? DIRS.projects;
	return path.join(base, ".extractor.lock");
}

/**
 * Create a pidfile lock. Returns a release function, or null if a live lock
 * already exists. Stale locks (pid no longer running) are reclaimed.
 */
function acquireExtractorLock(projectsDir?: string): (() => void) | null {
	const lp = lockPath(projectsDir);
	fs.mkdirSync(path.dirname(lp), { recursive: true });

	if (fs.existsSync(lp)) {
		const pid = Number(fs.readFileSync(lp, "utf-8").trim());
		if (Number.isFinite(pid) && pid > 0 && isPidAlive(pid)) return null;
		try {
			fs.unlinkSync(lp);
		} catch {
			// Race: someone else cleaned up. Continue.
		}
	}

	try {
		// wx = exclusive create; fails if another process wins the race.
		fs.writeFileSync(lp, String(process.pid), { flag: "wx" });
	} catch {
		return null;
	}

	return () => {
		try {
			fs.unlinkSync(lp);
		} catch {
			// Already gone - nothing to do.
		}
	};
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Run the LLM and parse its JSON response into an ExtractionResult.
 */
async function extractFromSession(args: {
	session: NormalizedSession;
	model: string;
	complete: CompleteFn;
	projectName: string;
}): Promise<ExtractionResult> {
	const { session, model, complete } = args;

	const userPrompt = `Session ID: ${session.sessionId}
Started: ${session.startedAt}
Working dir: ${session.cwd}

Transcript:
---
${session.transcript}
---`;

	const r = await complete({
		model,
		system: EXTRACTOR_SYSTEM_PROMPT,
		prompt: userPrompt,
	});
	if (!r.ok) {
		throw new Error(r.error ?? "completion failed");
	}

	const parsed = parseExtractionJson(r.text);
	return {
		session_id: session.sessionId,
		timestamp: session.startedAt,
		decisions: (parsed.decisions ?? []).map((d) => ({
			id: "", // populated when persisted
			timestamp: session.startedAt,
			session_id: session.sessionId,
			project: args.projectName,
			content: String(d.content ?? "").trim(),
			confidence: 0.65, // auto-extracted; manual /decide stays at 0.95
			source: "auto",
			tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
		})),
		thread_updates: (parsed.thread_updates ?? []).map((t) => ({
			thread_id: "new",
			title: String(t.title ?? "").trim() || "Untitled",
			message: {
				timestamp: session.startedAt,
				session_id: session.sessionId,
				role: "system",
				content: String(t.summary ?? "").trim(),
			},
		})),
		persona_deltas: (parsed.persona_deltas ?? []).map((p) => ({
			id: "",
			timestamp: session.startedAt,
			session_id: session.sessionId,
			field: String(p.field ?? "general").trim(),
			delta_type: normalizeDeltaType(p.delta_type),
			content: String(p.content ?? "").trim(),
			confidence: 0.65,
			applied: false,
		})),
	};
}

interface RawExtraction {
	decisions?: Array<{ content?: unknown; tags?: unknown }>;
	thread_updates?: Array<{ title?: unknown; summary?: unknown }>;
	persona_deltas?: Array<{ field?: unknown; delta_type?: unknown; content?: unknown }>;
}

/**
 * Best-effort parser. Tolerates surrounding whitespace, code fences, or trailing prose
 * because not every local model is perfectly behaved.
 */
export function parseExtractionJson(raw: string): RawExtraction {
	const trimmed = raw.trim();
	if (!trimmed) return {};

	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced ? fenced[1] : firstJsonObject(trimmed);
	if (!candidate) return {};

	try {
		return JSON.parse(candidate) as RawExtraction;
	} catch {
		return {};
	}
}

interface ScanState {
	depth: number;
	inString: boolean;
	escape: boolean;
}

function advance(state: ScanState, ch: string): boolean {
	if (state.escape) {
		state.escape = false;
		return false;
	}
	if (ch === "\\") {
		state.escape = true;
		return false;
	}
	if (ch === '"') {
		state.inString = !state.inString;
		return false;
	}
	if (state.inString) return false;
	if (ch === "{") state.depth++;
	else if (ch === "}") {
		state.depth--;
		return state.depth === 0;
	}
	return false;
}

function firstJsonObject(s: string): string | null {
	const start = s.indexOf("{");
	if (start < 0) return null;
	const state: ScanState = { depth: 0, inString: false, escape: false };
	for (let i = start; i < s.length; i++) {
		if (advance(state, s[i] ?? "")) return s.slice(start, i + 1);
	}
	return null;
}

function normalizeDeltaType(value: unknown): "add" | "update" | "contradict" {
	const s = String(value ?? "").toLowerCase();
	if (s === "update" || s === "contradict") return s;
	return "add";
}

interface PersistCounts {
	decisions: number;
	threads: number;
	personaDeltas: number;
}

function persistExtraction(
	project: ProjectState,
	extracted: ExtractionResult,
	session: NormalizedSession,
	projectName: string,
): PersistCounts {
	const counts: PersistCounts = { decisions: 0, threads: 0, personaDeltas: 0 };

	for (const d of extracted.decisions) {
		if (!d.content) continue;
		project.decisions.addDecision({
			sessionId: session.sessionId,
			project: projectName,
			content: d.content,
			confidence: d.confidence,
			source: "auto",
			tags: d.tags,
		});
		counts.decisions++;
	}

	for (const t of extracted.thread_updates) {
		if (!t.title || !t.message?.content) continue;
		project.threads.createThread({
			project: projectName,
			title: t.title,
			firstMessage: t.message,
		});
		counts.threads++;
	}

	for (const p of extracted.persona_deltas) {
		if (!p.content) continue;
		project.persona.addDelta({
			sessionId: session.sessionId,
			field: p.field,
			deltaType: p.delta_type,
			content: p.content,
			confidence: p.confidence,
		});
		counts.personaDeltas++;
	}

	return counts;
}

// --- Anchor checkpoint (single, projects-dir-wide) ---------------------------

function anchorPath(projectsDir?: string): string {
	const base = projectsDir ?? DIRS.projects;
	return path.join(base, ".extractor-anchor.json");
}

export function getAnchorCheckpoint(projectsDir?: string): ExtractorCheckpoint | null {
	const p = anchorPath(projectsDir);
	if (!fs.existsSync(p)) return null;
	return new CheckpointManager(p).read();
}

export function writeAnchorCheckpoint(checkpoint: ExtractorCheckpoint, projectsDir?: string): void {
	new CheckpointManager(anchorPath(projectsDir)).write(checkpoint);
}

export function resetAnchorCheckpoint(projectsDir?: string): void {
	new CheckpointManager(anchorPath(projectsDir)).reset();
}
