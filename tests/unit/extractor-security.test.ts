/**
 * Security regression tests for the memory extractor (v0.1.15 hardening).
 *
 * Covers the findings from the v0.1.14 → v0.1.15 internal audit:
 *   1. Dispatch-mode invocation strips underscore-prefixed hooks.
 *   2. Session JSONL files above MAX_SESSION_JSONL_BYTES are skipped.
 *   3. Transcript content is passed through redactSecrets before LLM ingest.
 *   4. Ollama completions are capped at MAX_COMPLETION_BYTES.
 *   5. Concurrent runExtraction calls cannot both process sessions.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/config/schema.js";
import { getProjectBinding } from "../../src/core/session.js";
import { type CompleteFn, runExtraction } from "../../src/memory/extractor.js";
import { MAX_SESSION_JSONL_BYTES, normalizeSession } from "../../src/memory/session-reader.js";
import { closeProject, loadProject } from "../../src/projects/loader.js";
import { MAX_COMPLETION_BYTES } from "../../src/providers/ollama-complete.js";
import { memoryExtractHandler } from "../../src/skills/memory-extract.js";

function baseConfig(): Config {
	return {
		version: 1,
		operator: { name: "t", timezone: "UTC" },
		default_model: "ollama/test",
		tier_routing: { default: "ollama/test" },
		embeddings: { enabled: false },
		daily_log: {
			enabled: true,
			cron: "0 20 * * *",
			channel: "cli",
			auto_prompt_next_morning_if_missed: true,
		},
		backup: {
			enabled: true,
			cron: "30 2 * * *",
			retention_days: 30,
			destinations: [{ type: "local", path: "/tmp/x" }],
			include_secrets: false,
		},
		channels: {
			cli: { enabled: true, tool_escape_hatch: false },
			telegram: {
				enabled: false,
				tool_escape_hatch: false,
				allowed_peers: [],
				allow_groups: false,
			},
		},
		extractor: { cron: "0 2 * * *" },
	};
}

const CWD = "/home/t/sec";
const SESSION_DIR = `--${CWD.replace(/\//g, "-")}--`;

function writeSession(
	dir: string,
	opts: { id: string; ts?: string; tsFile?: string; turns: Array<{ role: string; text: string }> },
) {
	const sessionDir = path.join(dir, SESSION_DIR);
	fs.mkdirSync(sessionDir, { recursive: true });
	const ts = opts.ts ?? "2026-04-14T10:00:00.000Z";
	const tsFile = opts.tsFile ?? "2026-04-14T10-00-00-000Z";
	const file = path.join(sessionDir, `${tsFile}_${opts.id}.jsonl`);
	const events: unknown[] = [{ type: "session", version: 3, id: opts.id, timestamp: ts, cwd: CWD }];
	opts.turns.forEach((t, i) =>
		events.push({
			type: "message",
			id: `m${i}`,
			timestamp: ts,
			message: { role: t.role, content: [{ type: "text", text: t.text }] },
		}),
	);
	fs.writeFileSync(file, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
	return file;
}

describe("Security: dispatch-mode strips underscore hooks", () => {
	let sessionsDir: string;
	let projectsDir: string;
	let ctx: {
		project: ReturnType<typeof loadProject>;
		config: Config;
		channelType: "cli";
		sessionId: string;
	};

	beforeEach(() => {
		sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-sec-sess-"));
		projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-sec-proj-"));
		const project = loadProject(getProjectBinding("cli", CWD), projectsDir);
		ctx = { project, config: baseConfig(), channelType: "cli", sessionId: "s" };
	});

	afterEach(() => {
		closeProject(ctx.project);
		fs.rmSync(sessionsDir, { recursive: true, force: true });
		fs.rmSync(projectsDir, { recursive: true, force: true });
	});

	it("ignores _projectsDir / _sessionsDir / _complete when action is present", async () => {
		writeSession(sessionsDir, {
			id: "sec-a",
			turns: [{ role: "user", text: "hi" }],
		});
		const canned: CompleteFn = async () => ({
			ok: true,
			text: '{"decisions":[{"content":"this should NEVER persist"}]}',
		});

		const result = await memoryExtractHandler(
			{
				action: "memory.extract",
				params: {
					_complete: canned,
					_sessionsDir: sessionsDir,
					_projectsDir: projectsDir,
					dry_run: true,
				},
				confirm: false,
			},
			ctx,
		);
		expect(result.success).toBe(true);
		const data = result.data as { processed_sessions: number };
		// Our tmp session was not processed because _sessionsDir was dropped.
		// (If the hook had been honored, this would be 1.)
		expect(data.processed_sessions).toBe(0);
	});

	it("honors underscore hooks ONLY when called directly (no `action` key)", async () => {
		writeSession(sessionsDir, {
			id: "sec-b",
			turns: [{ role: "user", text: "hi" }],
		});
		const canned: CompleteFn = async () => ({
			ok: true,
			text: '{"decisions":[{"content":"d"}]}',
		});
		const result = await memoryExtractHandler(
			{
				dry_run: true,
				_complete: canned,
				_sessionsDir: sessionsDir,
				_projectsDir: projectsDir,
			},
			ctx,
		);
		const data = result.data as { processed_sessions: number };
		expect(data.processed_sessions).toBe(1);
	});
});

describe("Security: session file size cap", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-size-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("exposes a reasonable cap constant", () => {
		expect(MAX_SESSION_JSONL_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
		expect(MAX_SESSION_JSONL_BYTES).toBeLessThanOrEqual(512 * 1024 * 1024);
	});

	it("skips a session file that exceeds the cap", () => {
		const file = path.join(dir, "huge.jsonl");
		// Truncate-write a sparse file just above the cap - cheap way to hit
		// stat.size without actually burning RAM.
		const fd = fs.openSync(file, "w");
		fs.ftruncateSync(fd, MAX_SESSION_JSONL_BYTES + 1);
		fs.closeSync(fd);
		expect(normalizeSession(file)).toBeNull();
	});
});

describe("Security: transcript secret redaction", () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-redact-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("redacts bot tokens, bearer tokens, and api keys from transcript lines", () => {
		const file = writeSession(dir, {
			id: "leak",
			turns: [
				{
					role: "user",
					text: "here is my token Bearer abc123xyz and api_key=super_secret_value_should_be_hidden",
				},
				{
					role: "assistant",
					text: "bot: 123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA and sk-abcdefghijklmnopqrstuvwxyz",
				},
			],
		});
		const norm = normalizeSession(file);
		expect(norm).not.toBeNull();
		expect(norm?.transcript).not.toContain("abc123xyz");
		expect(norm?.transcript).toContain("Bearer [REDACTED]");
		expect(norm?.transcript).not.toContain("super_secret_value_should_be_hidden");
		expect(norm?.transcript).not.toContain("123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
		expect(norm?.transcript).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
	});
});

describe("Security: LLM response cap", () => {
	it("exposes a reasonable cap constant", () => {
		expect(MAX_COMPLETION_BYTES).toBeGreaterThanOrEqual(8 * 1024);
		expect(MAX_COMPLETION_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024);
	});
});

describe("Security: concurrency lock", () => {
	let sessionsDir: string;
	let projectsDir: string;

	beforeEach(() => {
		sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-lock-sess-"));
		projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-lock-proj-"));
	});
	afterEach(() => {
		fs.rmSync(sessionsDir, { recursive: true, force: true });
		fs.rmSync(projectsDir, { recursive: true, force: true });
	});

	it("prevents two overlapping runExtraction calls from racing", async () => {
		// Write enough sessions that the LLM mock has real work to chew on.
		for (let i = 0; i < 3; i++) {
			writeSession(sessionsDir, {
				id: `lock-${i}`,
				ts: `2026-04-14T1${i}:00:00.000Z`,
				tsFile: `2026-04-14T1${i}-00-00-000Z`,
				turns: [{ role: "user", text: `session ${i}` }],
			});
		}

		// Mock LLM delays so the first run is still holding the lock when the
		// second one starts.
		const slow: CompleteFn = async () => {
			await new Promise((r) => setTimeout(r, 25));
			return { ok: true, text: '{"decisions":[{"content":"x"}]}' };
		};

		const [a, b] = await Promise.all([
			runExtraction({
				model: "ollama/test",
				sessionsDir,
				projectsDir,
				complete: slow,
			}),
			runExtraction({
				model: "ollama/test",
				sessionsDir,
				projectsDir,
				complete: slow,
			}),
		]);

		// Exactly one run should do the work; the other should bail out with a
		// lock failure (processedSessions === 0, a single lock-failure entry).
		const winner = a.processedSessions > 0 ? a : b;
		const loser = a.processedSessions > 0 ? b : a;
		expect(winner.processedSessions).toBe(3);
		expect(loser.processedSessions).toBe(0);
		expect(loser.failures).toHaveLength(1);
		expect(loser.failures[0]?.error).toMatch(/already in progress/);

		// Lock is released on exit - a fresh run should succeed again.
		const third = await runExtraction({
			model: "ollama/test",
			sessionsDir,
			projectsDir,
			resetCheckpoint: true,
			complete: slow,
		});
		expect(third.processedSessions).toBe(3);
	});
});
