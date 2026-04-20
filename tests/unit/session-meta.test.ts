import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mp-session-meta-"));
const fakeHome = path.join(tmpRoot, "home");
fs.mkdirSync(fakeHome, { recursive: true });
vi.stubEnv("HOME", fakeHome);
const originalHomedir = os.homedir;
(os as { homedir: () => string }).homedir = () => fakeHome;

const { readSessionMeta, writeSessionMeta } = await import("../../src/core/session-meta.js");

beforeEach(() => {
	const metaDir = path.join(fakeHome, ".mypensieve", "state", "session-meta");
	fs.rmSync(metaDir, { recursive: true, force: true });
});

afterEach(() => {
	(os as { homedir: () => string }).homedir = originalHomedir;
});

describe("session-meta", () => {
	it("writes and reads a cli session marker", () => {
		writeSessionMeta({
			session_id: "sess-abc",
			channel_type: "cli",
			timestamp: "2026-04-20T00:00:00Z",
		});
		const back = readSessionMeta("sess-abc");
		expect(back?.channel_type).toBe("cli");
	});

	it("writes and reads a telegram session marker with peer_id", () => {
		writeSessionMeta({
			session_id: "sess-xyz",
			channel_type: "telegram",
			peer_id: "12345",
			timestamp: "2026-04-20T00:00:00Z",
		});
		const back = readSessionMeta("sess-xyz");
		expect(back?.channel_type).toBe("telegram");
		expect(back?.peer_id).toBe("12345");
	});

	it("returns null for unknown session", () => {
		expect(readSessionMeta("no-such-session")).toBeNull();
	});

	it("does not clobber when two IDs sanitize to the same prefix", () => {
		writeSessionMeta({
			session_id: "a/b",
			channel_type: "cli",
			timestamp: "2026-04-20T00:00:00Z",
		});
		writeSessionMeta({
			session_id: "a_b",
			channel_type: "telegram",
			peer_id: "99",
			timestamp: "2026-04-20T00:00:01Z",
		});
		expect(readSessionMeta("a/b")?.channel_type).toBe("cli");
		expect(readSessionMeta("a_b")?.channel_type).toBe("telegram");
	});

	it("sanitizes session IDs with path separators", () => {
		writeSessionMeta({
			session_id: "../escape",
			channel_type: "cli",
			timestamp: "2026-04-20T00:00:00Z",
		});
		// The read uses the same sanitization so it should still round-trip,
		// but the file should NOT escape the session-meta dir.
		const metaDir = path.join(fakeHome, ".mypensieve", "state", "session-meta");
		const entries = fs.readdirSync(metaDir);
		expect(entries.length).toBe(1);
		expect(entries[0]).not.toContain("/");
		expect(entries[0]).not.toContain("..");
	});
});
