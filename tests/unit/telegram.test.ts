import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PeerSessionManager, PeerNotAllowedError } from "../../src/channels/telegram/sessions.js";
import { chunkMessage, toTelegramMarkdown } from "../../src/channels/telegram/formatter.js";
import type { Config } from "../../src/config/schema.js";

function validConfig(allowedPeers: string[] = ["peer-123", "peer-a", "peer-b", "peer-old", "peer-active"]): Config {
	return {
		version: 1,
		operator: { name: "Test", timezone: "UTC" },
		tier_routing: { default: "ollama/llama3" },
		embeddings: { enabled: false },
		daily_log: { enabled: true, cron: "0 20 * * *", channel: "cli", auto_prompt_next_morning_if_missed: true },
		backup: { enabled: true, cron: "30 2 * * *", retention_days: 30, destinations: [{ type: "local", path: "/tmp" }], include_secrets: false },
		channels: {
			cli: { enabled: true, tool_escape_hatch: false },
			telegram: { enabled: true, tool_escape_hatch: false, allowed_peers: allowedPeers, allow_groups: false },
		},
		extractor: { cron: "0 2 * * *" },
	};
}

describe("PeerSessionManager", () => {
	let tmpDir: string;
	let manager: PeerSessionManager;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-sessions-"));
		manager = new PeerSessionManager(validConfig(), {
			timeoutMs: 100, // 100ms for testing
			projectsDir: path.join(tmpDir, "projects"),
		});
	});

	afterEach(() => {
		manager.closeAll();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates a new session for unknown peer", () => {
		const session = manager.getOrCreate("peer-123");
		expect(session.peerId).toBe("peer-123");
		expect(session.binding).toBe("telegram/peer-123");
		expect(manager.count()).toBe(1);
	});

	it("reuses existing session for known peer", () => {
		const s1 = manager.getOrCreate("peer-123");
		const s2 = manager.getOrCreate("peer-123");
		expect(manager.count()).toBe(1);
		// Same project reference
		expect(s1.project.binding).toBe(s2.project.binding);
	});

	it("creates separate sessions for different peers", () => {
		manager.getOrCreate("peer-a");
		manager.getOrCreate("peer-b");
		expect(manager.count()).toBe(2);
	});

	it("updates lastActivity on access", async () => {
		const s1 = manager.getOrCreate("peer-123");
		const firstActivity = s1.lastActivity;

		await new Promise((r) => setTimeout(r, 10));
		manager.getOrCreate("peer-123");
		expect(s1.lastActivity).toBeGreaterThan(firstActivity);
	});

	it("reaps inactive sessions", async () => {
		manager.getOrCreate("peer-old");
		await new Promise((r) => setTimeout(r, 150)); // Wait for timeout

		const reaped = manager.reapInactive();
		expect(reaped).toBe(1);
		expect(manager.count()).toBe(0);
	});

	it("does not reap active sessions", async () => {
		manager.getOrCreate("peer-active");
		await new Promise((r) => setTimeout(r, 50));
		manager.getOrCreate("peer-active"); // refresh

		const reaped = manager.reapInactive();
		expect(reaped).toBe(0);
		expect(manager.count()).toBe(1);
	});

	it("closes a specific session", () => {
		manager.getOrCreate("peer-123");
		manager.close("peer-123");
		expect(manager.count()).toBe(0);
		expect(manager.has("peer-123")).toBe(false);
	});

	it("lists active peers", () => {
		manager.getOrCreate("peer-a");
		manager.getOrCreate("peer-b");
		const peers = manager.activePeers();
		expect(peers).toContain("peer-a");
		expect(peers).toContain("peer-b");
	});

	it("session has working dispatcher", async () => {
		const session = manager.getOrCreate("peer-123");

		// Add a decision directly
		session.project.decisions.addDecision({
			sessionId: "s1", project: session.binding,
			content: "Test decision via Telegram", confidence: 0.95, source: "manual",
		});

		// Recall via dispatcher
		const result = await session.dispatcher.dispatch(
			"recall",
			{ query: "Telegram" },
			{ channelType: "telegram", project: session.binding },
		);

		const data = result.result as { matches: Array<{ content: string }> };
		expect(data.matches.some((m) => m.content.includes("Telegram"))).toBe(true);
	});

	it("peer sessions have isolated memory", async () => {
		const sessionA = manager.getOrCreate("peer-a");
		const sessionB = manager.getOrCreate("peer-b");

		sessionA.project.decisions.addDecision({
			sessionId: "s1", project: sessionA.binding,
			content: "Secret A only", confidence: 0.95, source: "manual",
		});

		// Query from peer B should not find peer A's data (different project dir)
		const resultB = await sessionB.dispatcher.dispatch(
			"recall",
			{ query: "Secret A" },
			{ channelType: "telegram", project: sessionB.binding },
		);

		const matchesB = (resultB.result as { matches: Array<{ content: string }> }).matches;
		expect(matchesB.some((m) => m.content.includes("Secret A"))).toBe(false);
	});
});

describe("Telegram formatter", () => {
	it("returns single chunk for short messages", () => {
		const chunks = chunkMessage("Hello world");
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toBe("Hello world");
	});

	it("splits long messages at newlines", () => {
		const longText = "Line 1\n".repeat(1000);
		const chunks = chunkMessage(longText);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(4096);
		}
	});

	it("handles messages with no good split points", () => {
		const noBreaks = "a".repeat(5000);
		const chunks = chunkMessage(noBreaks);
		expect(chunks.length).toBe(2);
		expect(chunks[0]?.length).toBe(4096);
	});

	it("converts markdown headers to bold", () => {
		const md = "# Hello\n## World\n### Test";
		const result = toTelegramMarkdown(md);
		expect(result).toContain("*Hello*");
		expect(result).toContain("*World*");
		expect(result).toContain("*Test*");
	});
});

describe("Telegram peer security", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-security-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("rejects unknown peers", () => {
		const manager = new PeerSessionManager(validConfig(["peer-allowed"]), {
			projectsDir: path.join(tmpDir, "projects"),
		});

		expect(() => manager.getOrCreate("peer-stranger")).toThrow(PeerNotAllowedError);
		expect(manager.count()).toBe(0);
		manager.closeAll();
	});

	it("allows configured peers", () => {
		const manager = new PeerSessionManager(validConfig(["peer-allowed"]), {
			projectsDir: path.join(tmpDir, "projects"),
		});

		const session = manager.getOrCreate("peer-allowed");
		expect(session.peerId).toBe("peer-allowed");
		expect(manager.count()).toBe(1);
		manager.closeAll();
	});

	it("rejects all peers when allowed_peers is empty", () => {
		const manager = new PeerSessionManager(validConfig([]), {
			projectsDir: path.join(tmpDir, "projects"),
		});

		expect(() => manager.getOrCreate("anyone")).toThrow(PeerNotAllowedError);
		manager.closeAll();
	});

	it("isPeerAllowed returns correct results", () => {
		const manager = new PeerSessionManager(validConfig(["peer-ok"]), {
			projectsDir: path.join(tmpDir, "projects"),
		});

		expect(manager.isPeerAllowed("peer-ok")).toBe(true);
		expect(manager.isPeerAllowed("peer-bad")).toBe(false);
		manager.closeAll();
	});

	it("groups disabled by default", () => {
		const manager = new PeerSessionManager(validConfig(), {
			projectsDir: path.join(tmpDir, "projects"),
		});

		expect(manager.isGroupAllowed()).toBe(false);
		manager.closeAll();
	});
});
