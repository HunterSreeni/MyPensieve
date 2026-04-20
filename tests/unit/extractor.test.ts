import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cronToOnCalendar } from "../../src/cli/commands/extractor-timer.js";
import {
	type CompleteFn,
	getAnchorCheckpoint,
	resetAnchorCheckpoint,
	runExtraction,
} from "../../src/memory/extractor.js";
import { parseExtractionJson } from "../../src/memory/extractor.js";
import { listSessionFiles, normalizeSession } from "../../src/memory/session-reader.js";

// Sample Pi session matches the real schema we saw on disk.
function writeSampleSession(dir: string, opts: { id: string; tsIso: string; tsFile: string }) {
	const sessionDir = path.join(dir, "--home-test-project--");
	fs.mkdirSync(sessionDir, { recursive: true });
	const file = path.join(sessionDir, `${opts.tsFile}_${opts.id}.jsonl`);
	const lines = [
		{
			type: "session",
			version: 3,
			id: opts.id,
			timestamp: opts.tsIso,
			cwd: "/home/test/project",
		},
		{
			type: "model_change",
			id: "m1",
			parentId: null,
			timestamp: opts.tsIso,
			provider: "ollama",
			modelId: "test-model",
		},
		{
			type: "message",
			id: "u1",
			timestamp: opts.tsIso,
			message: {
				role: "user",
				content: [{ type: "text", text: "Should we use SQLite or Postgres for the index?" }],
			},
		},
		{
			type: "message",
			id: "a1",
			timestamp: opts.tsIso,
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "Going with SQLite because it's embedded and zero-ops." },
					{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } },
				],
			},
		},
		{
			type: "message",
			id: "t1",
			timestamp: opts.tsIso,
			message: {
				role: "toolResult",
				toolName: "bash",
				content: [{ type: "text", text: "ok" }],
			},
		},
	];
	fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf-8");
	return file;
}

describe("session-reader", () => {
	let tmpDir: string;
	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-sr-"));
	});
	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("lists session files newest-last", () => {
		writeSampleSession(tmpDir, {
			id: "s-2",
			tsIso: "2026-04-12T05:38:19.188Z",
			tsFile: "2026-04-12T05-38-19-188Z",
		});
		writeSampleSession(tmpDir, {
			id: "s-1",
			tsIso: "2026-04-11T05:00:00.000Z",
			tsFile: "2026-04-11T05-00-00-000Z",
		});
		const files = listSessionFiles(undefined, tmpDir);
		expect(files).toHaveLength(2);
		expect(files[0]).toContain("2026-04-11");
		expect(files[1]).toContain("2026-04-12");
	});

	it("filters by `since` boundary", () => {
		writeSampleSession(tmpDir, {
			id: "old",
			tsIso: "2026-04-10T00:00:00.000Z",
			tsFile: "2026-04-10T00-00-00-000Z",
		});
		writeSampleSession(tmpDir, {
			id: "new",
			tsIso: "2026-04-13T00:00:00.000Z",
			tsFile: "2026-04-13T00-00-00-000Z",
		});
		const files = listSessionFiles("2026-04-12T00:00:00.000Z", tmpDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toContain("2026-04-13");
	});

	it("normalizes a session into a transcript", () => {
		const file = writeSampleSession(tmpDir, {
			id: "s-x",
			tsIso: "2026-04-12T05:38:19.188Z",
			tsFile: "2026-04-12T05-38-19-188Z",
		});
		const norm = normalizeSession(file);
		expect(norm).not.toBeNull();
		expect(norm?.sessionId).toBe("s-x");
		expect(norm?.cwd).toBe("/home/test/project");
		expect(norm?.transcript).toContain("[user] Should we use SQLite");
		expect(norm?.transcript).toContain("[assistant] Going with SQLite");
		expect(norm?.transcript).toContain("[assistant:tool-call] bash");
		expect(norm?.transcript).toContain("[toolResult] ok");
	});

	it("returns null for missing or empty files", () => {
		expect(normalizeSession(path.join(tmpDir, "nope.jsonl"))).toBeNull();
		const empty = path.join(tmpDir, "empty.jsonl");
		fs.writeFileSync(empty, "");
		expect(normalizeSession(empty)).toBeNull();
	});
});

describe("parseExtractionJson", () => {
	it("parses raw JSON", () => {
		const r = parseExtractionJson('{"decisions":[{"content":"x"}]}');
		expect(r.decisions?.[0]?.content).toBe("x");
	});

	it("strips ```json fences", () => {
		const r = parseExtractionJson('```json\n{"decisions":[]}\n```');
		expect(r.decisions).toEqual([]);
	});

	it("extracts the first JSON object from prose", () => {
		const r = parseExtractionJson(
			'Here is the JSON: {"persona_deltas":[{"field":"style","content":"terse"}]} thanks',
		);
		expect(r.persona_deltas?.[0]?.field).toBe("style");
	});

	it("returns empty object on garbage", () => {
		expect(parseExtractionJson("not json")).toEqual({});
		expect(parseExtractionJson("")).toEqual({});
	});
});

describe("cronToOnCalendar", () => {
	it("converts simple daily crons", () => {
		expect(cronToOnCalendar("0 2 * * *")).toBe("*-*-* 02:00:00");
		expect(cronToOnCalendar("30 14 * * *")).toBe("*-*-* 14:30:00");
	});
	it("falls back to daily on unsupported expressions", () => {
		expect(cronToOnCalendar("*/15 * * * *")).toBe("daily");
		expect(cronToOnCalendar("invalid")).toBe("daily");
	});
});

describe("runExtraction (with mocked LLM)", () => {
	let sessionsDir: string;
	let projectsDir: string;

	beforeEach(() => {
		sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-ext-sess-"));
		projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-ext-proj-"));
	});
	afterEach(() => {
		fs.rmSync(sessionsDir, { recursive: true, force: true });
		fs.rmSync(projectsDir, { recursive: true, force: true });
	});

	const fakeComplete: CompleteFn = vi.fn(async () => ({
		ok: true,
		text: JSON.stringify({
			decisions: [{ content: "Use SQLite for memory index", tags: ["arch"] }],
			thread_updates: [{ title: "Index choice", summary: "SQLite vs Postgres" }],
			persona_deltas: [
				{ field: "preferences", delta_type: "add", content: "prefers embedded DBs" },
			],
		}),
	}));

	it("processes new sessions and writes to layers", async () => {
		writeSampleSession(sessionsDir, {
			id: "sess-A",
			tsIso: "2026-04-12T05:38:19.188Z",
			tsFile: "2026-04-12T05-38-19-188Z",
		});

		const result = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete: fakeComplete,
		});

		expect(result.processedSessions).toBe(1);
		expect(result.decisionsAdded).toBe(1);
		expect(result.threadsAdded).toBe(1);
		expect(result.personaDeltasAdded).toBe(1);
		expect(result.failures).toEqual([]);

		// Anchor checkpoint advances
		const cp = getAnchorCheckpoint(projectsDir);
		expect(cp?.last_processed_session_id).toBe("sess-A");
		expect(cp?.last_run_status).toBe("success");
	});

	it("is idempotent on re-run via checkpoint", async () => {
		writeSampleSession(sessionsDir, {
			id: "sess-B",
			tsIso: "2026-04-12T05:38:19.188Z",
			tsFile: "2026-04-12T05-38-19-188Z",
		});

		const first = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete: fakeComplete,
		});
		expect(first.processedSessions).toBe(1);

		const second = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete: fakeComplete,
		});
		expect(second.processedSessions).toBe(0);
	});

	it("dry-run does not advance the checkpoint", async () => {
		writeSampleSession(sessionsDir, {
			id: "sess-D",
			tsIso: "2026-04-12T05:38:19.188Z",
			tsFile: "2026-04-12T05-38-19-188Z",
		});

		const result = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			dryRun: true,
			complete: fakeComplete,
		});
		expect(result.processedSessions).toBe(1);
		expect(result.decisionsAdded).toBe(1);
		expect(getAnchorCheckpoint(projectsDir)).toBeNull();
	});

	it("resetCheckpoint reprocesses everything", async () => {
		writeSampleSession(sessionsDir, {
			id: "sess-E",
			tsIso: "2026-04-12T05:38:19.188Z",
			tsFile: "2026-04-12T05-38-19-188Z",
		});

		await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete: fakeComplete,
		});
		resetAnchorCheckpoint(projectsDir);
		const second = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			resetCheckpoint: true,
			complete: fakeComplete,
		});
		expect(second.processedSessions).toBe(1);
	});

	it("records failures when the LLM errors", async () => {
		writeSampleSession(sessionsDir, {
			id: "sess-F",
			tsIso: "2026-04-12T05:38:19.188Z",
			tsFile: "2026-04-12T05-38-19-188Z",
		});
		const failing: CompleteFn = async () => ({ ok: false, text: "", error: "boom" });

		const result = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete: failing,
		});
		expect(result.processedSessions).toBe(0);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]?.error).toContain("boom");
	});

	it("rejects unknown providers without an injected complete fn", async () => {
		await expect(
			runExtraction({ model: "made-up-provider/some-model", sessionsDir, projectsDir }),
		).rejects.toThrow(/made-up-provider/i);
	});

	it("writes per-channel anchors and skips sessions already processed by that channel", async () => {
		writeSampleSession(sessionsDir, {
			id: "sess-pc-1",
			tsIso: "2026-04-12T05:38:19.188Z",
			tsFile: "2026-04-12T05-38-19-188Z",
		});

		await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete: fakeComplete,
		});

		const anchorsPath = path.join(projectsDir, ".extractor-anchors.json");
		expect(fs.existsSync(anchorsPath)).toBe(true);
		const anchors = JSON.parse(fs.readFileSync(anchorsPath, "utf-8"));
		// Session has no session-meta marker so it defaults to "cli"
		expect(anchors.cli.last_processed_session_id).toBe("sess-pc-1");

		// Second run: the "cli" channel's anchor blocks re-processing
		const second = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete: fakeComplete,
		});
		expect(second.processedSessions).toBe(0);
	});

	it("requires a model", async () => {
		await expect(runExtraction({ sessionsDir, projectsDir })).rejects.toThrow(/no model/i);
	});
});
