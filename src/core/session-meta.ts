/**
 * Per-session channel metadata.
 *
 * Pi sessions are opaque to the extractor - their JSONL headers include cwd
 * and ID but no channel marker. The MyPensieve extension knows the channel
 * at session_start and writes a tiny marker file here so the extractor can
 * later attribute each session to its originating channel.
 *
 * File format: ~/.mypensieve/state/session-meta/<sessionId>.json
 *   { "session_id": "...", "channel_type": "cli" | "telegram", "peer_id"?: "..." , "timestamp": "..." }
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../config/paths.js";

export type ChannelType = "cli" | "telegram";

export interface SessionMeta {
	session_id: string;
	channel_type: ChannelType;
	peer_id?: string;
	timestamp: string;
}

function metaPath(sessionId: string): string {
	// Sanitize the ID for filesystem safety, then append a short content hash
	// so collisions between different IDs that sanitize to the same prefix
	// (e.g. "a/b" and "a_b") map to distinct files.
	const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
	const hash = crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
	return path.join(DIRS.sessionMeta, `${safe}.${hash}.json`);
}

/** Persist session metadata on session_start. Best-effort; never throws. */
export function writeSessionMeta(meta: SessionMeta): void {
	try {
		fs.mkdirSync(DIRS.sessionMeta, { recursive: true });
		fs.writeFileSync(metaPath(meta.session_id), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
	} catch {
		// Non-critical - extractor will fall back to "cli" for this session.
	}
}

/** Read metadata for a session. Returns null if the marker doesn't exist. */
export function readSessionMeta(sessionId: string): SessionMeta | null {
	const p = metaPath(sessionId);
	if (!fs.existsSync(p)) return null;
	try {
		const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as SessionMeta;
		if (!parsed.session_id || !parsed.channel_type) return null;
		return parsed;
	} catch {
		return null;
	}
}
