import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../config/paths.js";
import { parseModelString, resolveDefaultModel } from "../config/schema.js";
import type { Config } from "../config/schema.js";
import { readSessionMeta } from "../core/session-meta.js";
import { getProjectBinding } from "../core/session.js";

/**
 * Channels the extractor knows about. Used to detect "new channel first
 * appears" so we don't drop its older sessions when computing the since-bound.
 */
const KNOWN_CHANNELS = ["cli", "telegram"] as const;
import { captureError } from "../ops/index.js";
import { type ProjectState, closeProject, loadProject } from "../projects/loader.js";
import { buildCompleteFn } from "../providers/complete-factory.js";
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
	/** Inject a custom completion function. Defaults to provider-routed shim via buildCompleteFn. */
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

	// Build the one-shot completion function for the active provider.
	// Tests inject their own `opts.complete`; production uses the factory which
	// dispatches to Ollama/Anthropic/OpenAI/OpenRouter based on the provider name.
	const complete: CompleteFn = opts.complete ?? buildCompleteFn(provider);

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
		if (opts.resetCheckpoint) {
			resetAnchorCheckpoint(opts.projectsDir);
			resetPerChannelAnchors(opts.projectsDir);
		}

		// Determine `since` boundary: explicit > min(per-channel checkpoints)
		// across all known channels > legacy anchor > none.
		//
		// Correctness: if any KNOWN_CHANNEL has no anchor yet (fresh install,
		// newly-enabled channel, restored backup), we cannot safely trust the
		// min() of the channels we HAVE seen - a new channel's sessions may be
		// older than any existing anchor. Seed missing channels from the legacy
		// anchor (or leave unset to scan from the beginning) so no session is
		// dropped when a channel first appears.
		let since = opts.since;
		const channelAnchors = opts.resetCheckpoint
			? ({} as Record<string, ExtractorCheckpoint>)
			: readPerChannelAnchors(opts.projectsDir);
		if (!since && !opts.resetCheckpoint) {
			const missingKnown = KNOWN_CHANNELS.filter((c) => !channelAnchors[c]);
			if (missingKnown.length === 0) {
				// Every known channel has an anchor - safe to use min().
				const timestamps = Object.values(channelAnchors)
					.map((c) => c.last_processed_timestamp)
					.filter((t): t is string => !!t)
					.sort();
				if (timestamps.length > 0) since = timestamps[0];
			} else {
				// At least one channel has no anchor. Fall back to the legacy
				// anchor if present, else scan from the beginning. This ensures
				// the newly-appearing channel's older sessions are still listed;
				// the per-session skip below filters duplicates cheaply.
				const anchor = getAnchorCheckpoint(opts.projectsDir);
				if (anchor) since = anchor.last_processed_timestamp;
			}
		}

		const files = listSessionFiles(since, opts.sessionsDir);
		if (opts.verbose) {
			console.log(
				`[extractor] ${files.length} session file(s) to process (since=${since ?? "beginning"}).`,
			);
		}

		let lastTimestamp = since ?? "";
		let lastSessionId = "";
		// Per-channel accumulators: track the newest session timestamp we processed
		// per channel so we can advance each channel's anchor independently at the end.
		const perChannelProgress: Record<
			string,
			{ lastTimestamp: string; lastSessionId: string; count: number }
		> = {};

		for (const file of files) {
			const session = normalizeSession(file);
			if (!session || session.messageCount === 0) {
				result.skippedSessions++;
				continue;
			}

			// Derive channel from the session-meta marker written by the extension
			// at first agent start. Sessions predating the marker default to "cli".
			const meta = readSessionMeta(session.sessionId);
			const sessionChannel = meta?.channel_type ?? "cli";
			const binding = getProjectBinding(sessionChannel, session.cwd || "unknown");
			const projectName = binding;

			// Per-channel idempotency: skip sessions this channel has already processed.
			// Use strict `<` with session-id tiebreak so two distinct sessions sharing
			// the same startedAt timestamp aren't both dropped on the second run.
			const channelAnchor = channelAnchors[sessionChannel];
			if (
				channelAnchor &&
				(session.startedAt < channelAnchor.last_processed_timestamp ||
					(session.startedAt === channelAnchor.last_processed_timestamp &&
						session.sessionId <= channelAnchor.last_processed_session_id))
			) {
				result.skippedSessions++;
				continue;
			}

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
			// Track legacy anchor's max-of (timestamp, sessionId) so two
			// same-timestamp sessions are both reflected on the next run.
			if (
				session.startedAt > lastTimestamp ||
				(session.startedAt === lastTimestamp && session.sessionId > lastSessionId)
			) {
				lastTimestamp = session.startedAt;
				lastSessionId = session.sessionId;
			}

			// Track progress for this channel so we can write a per-channel anchor.
			// Use max-of (timestamp, sessionId) so same-timestamp siblings are
			// remembered correctly and the next run's tiebreak skips them.
			const prog = perChannelProgress[sessionChannel];
			const advances =
				!prog ||
				session.startedAt > prog.lastTimestamp ||
				(session.startedAt === prog.lastTimestamp && session.sessionId > prog.lastSessionId);
			if (advances) {
				perChannelProgress[sessionChannel] = {
					lastTimestamp: session.startedAt,
					lastSessionId: session.sessionId,
					count: (prog?.count ?? 0) + 1,
				};
			} else if (prog) {
				prog.count += 1;
			}

			if (opts.verbose) {
				console.log(
					`[extractor] ${session.sessionId} → ${extracted.decisions.length}d / ${extracted.thread_updates.length}t / ${extracted.persona_deltas.length}pd`,
				);
			}
		}

		// Advance anchors when we made progress and aren't dry-running.
		if (!opts.dryRun && result.processedSessions > 0) {
			// Legacy single anchor (kept for back-compat with older code paths).
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

			// Per-channel anchors: advance each channel that saw progress.
			const updated = { ...channelAnchors };
			for (const [channel, prog] of Object.entries(perChannelProgress)) {
				updated[channel] = {
					last_processed_session_id: prog.lastSessionId,
					last_processed_timestamp: prog.lastTimestamp,
					total_sessions_processed:
						(channelAnchors[channel]?.total_sessions_processed ?? 0) + prog.count,
					last_run_status: result.failures.length === 0 ? "success" : "partial",
					last_run_error: result.failures[0]?.error,
				};
			}
			writePerChannelAnchors(updated, opts.projectsDir);
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

// --- Per-channel anchors (v0.3.0+) -------------------------------------------

function perChannelAnchorsPath(projectsDir?: string): string {
	const base = projectsDir ?? DIRS.projects;
	return path.join(base, ".extractor-anchors.json");
}

/**
 * Read the per-channel anchor map. Returns {} when the file is absent or
 * unreadable - callers treat that as "no checkpoints yet, start from scratch".
 */
export function readPerChannelAnchors(projectsDir?: string): Record<string, ExtractorCheckpoint> {
	const p = perChannelAnchorsPath(projectsDir);
	if (!fs.existsSync(p)) return {};
	try {
		return JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, ExtractorCheckpoint>;
	} catch {
		return {};
	}
}

/** Write the per-channel anchor map atomically. */
export function writePerChannelAnchors(
	anchors: Record<string, ExtractorCheckpoint>,
	projectsDir?: string,
): void {
	const p = perChannelAnchorsPath(projectsDir);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	const tmp = `${p}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(anchors, null, 2)}\n`, "utf-8");
	fs.renameSync(tmp, p);
}

/** Reset the per-channel anchors (used by --all / resetCheckpoint). */
export function resetPerChannelAnchors(projectsDir?: string): void {
	const p = perChannelAnchorsPath(projectsDir);
	if (fs.existsSync(p)) fs.unlinkSync(p);
}
