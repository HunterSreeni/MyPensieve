import fs from "node:fs";
import path from "node:path";
import { PI_DIRS } from "../config/paths.js";
import { redactSecrets } from "../ops/errors/capture.js";
import { readJsonlSync } from "../utils/jsonl.js";

/**
 * Hard cap on JSONL file size we'll load into memory. Guards against runaway
 * / malicious session files forcing an OOM. A 50MB chat transcript is already
 * well past anything the extractor LLM can handle; skip and log instead.
 */
export const MAX_SESSION_JSONL_BYTES = 50 * 1024 * 1024;

/**
 * Pi session JSONL header (first line of every file).
 */
interface PiSessionHeader {
	type: "session";
	version: number;
	id: string;
	timestamp: string;
	cwd: string;
}

/**
 * Pi message event (the only event type the extractor cares about).
 * Other event types (model_change, thinking_level_change, etc.) are skipped.
 */
interface PiMessageEvent {
	type: "message";
	id: string;
	timestamp: string;
	message: {
		role: "user" | "assistant" | "toolResult" | "system";
		content?: Array<
			| { type: "text"; text: string }
			| { type: "toolCall"; name: string; arguments?: unknown }
			| { type: "toolResult"; toolName?: string; content?: unknown }
		>;
		toolName?: string;
	};
}

interface PiEventBase {
	type: string;
	timestamp?: string;
}

/**
 * A normalized session, suitable for feeding to the extractor LLM.
 * Tool calls and results are summarized; raw payloads are dropped.
 */
export interface NormalizedSession {
	/** Session ID from the JSONL header */
	sessionId: string;
	/** ISO start timestamp */
	startedAt: string;
	/** Working directory the session was launched from */
	cwd: string;
	/** Absolute path to the source JSONL file (for debugging / dedup) */
	sourcePath: string;
	/** Compact transcript ready to embed in an extraction prompt */
	transcript: string;
	/** Number of message events kept (text + tool summaries) */
	messageCount: number;
}

/**
 * List Pi session JSONL files newer than `sinceTimestamp` (exclusive).
 * Sessions are returned sorted by ascending start timestamp so checkpoints advance monotonically.
 *
 * @param sinceTimestamp - Only return sessions whose JSONL header timestamp is strictly greater.
 * @param sessionsDir - Override Pi sessions directory (test injection).
 */
export function listSessionFiles(
	sinceTimestamp?: string,
	sessionsDir: string = PI_DIRS.sessions,
): string[] {
	if (!fs.existsSync(sessionsDir)) return [];

	const files: Array<{ p: string; ts: string }> = [];
	for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const subDir = path.join(sessionsDir, entry.name);
		for (const f of fs.readdirSync(subDir)) {
			if (!f.endsWith(".jsonl")) continue;
			const full = path.join(subDir, f);
			// Filename starts with a sortable timestamp like 2026-04-12T05-38-19-188Z_...
			const ts = filenameTimestamp(f);
			if (sinceTimestamp && ts <= sinceTimestamp) continue;
			files.push({ p: full, ts });
		}
	}

	files.sort((a, b) => a.ts.localeCompare(b.ts));
	return files.map((f) => f.p);
}

/**
 * Extract the timestamp component encoded in the Pi session filename.
 * Pi format: `YYYY-MM-DDTHH-MM-SS-mmmZ_<uuid>.jsonl`. We restore the colons
 * so the result is comparable with ISO timestamps from JSONL records.
 */
function filenameTimestamp(filename: string): string {
	const stem = filename.replace(/\.jsonl$/, "");
	const tsPart = stem.split("_")[0] ?? stem;
	// Convert "2026-04-12T05-38-19-188Z" → "2026-04-12T05:38:19.188Z"
	const m = tsPart.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
	if (!m) return tsPart;
	return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
}

/**
 * Read a Pi session JSONL and produce a normalized session object.
 * Returns null if the file is unreadable or has no session header.
 */
export function normalizeSession(filePath: string): NormalizedSession | null {
	try {
		const stat = fs.statSync(filePath);
		if (stat.size > MAX_SESSION_JSONL_BYTES) return null;
	} catch {
		return null;
	}

	let events: PiEventBase[];
	try {
		events = readJsonlSync<PiEventBase>(filePath);
	} catch {
		return null;
	}

	if (events.length === 0) return null;
	const header = events[0] as unknown as PiSessionHeader;
	if (header.type !== "session" || !header.id) return null;

	const lines: string[] = [];
	let messageCount = 0;

	for (const ev of events) {
		if (ev.type !== "message") continue;
		const m = ev as unknown as PiMessageEvent;
		const role = m.message?.role;
		const content = m.message?.content;
		if (!role || !Array.isArray(content)) continue;

		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
				// Redact secrets before any downstream prompt-embed step: the extractor
				// will ship this transcript to an LLM, so keys / tokens / creds embedded
				// in prior tool output must not leave the process.
				const safe = redactSecrets(part.text.trim());
				lines.push(`[${role}] ${truncate(safe, 800)}`);
				messageCount++;
			} else if (part.type === "toolCall" && part.name) {
				lines.push(`[${role}:tool-call] ${part.name}`);
				messageCount++;
			} else if (part.type === "toolResult") {
				const tn = part.toolName ?? "unknown";
				lines.push(`[${role}:tool-result] ${tn}`);
				messageCount++;
			}
		}
	}

	return {
		sessionId: header.id,
		startedAt: header.timestamp,
		cwd: header.cwd ?? "",
		sourcePath: filePath,
		transcript: lines.join("\n"),
		messageCount,
	};
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max)}…`;
}
