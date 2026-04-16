/**
 * E2E: Memory extractor end-to-end flow.
 *
 * Simulates the full lifecycle:
 *   1. Operator runs three sessions over two days.
 *   2. Nightly extractor processes them, distilling decisions/threads/persona deltas.
 *   3. Re-running the next "night" picks up only the newest session (checkpoint).
 *   4. A third "night" with one transient LLM failure records the failure and
 *      still advances on the successful sessions.
 *   5. Dry-run mode never writes to disk.
 *   6. Final recall-by-keyword surfaces extracted records across all three layers.
 *
 * No real Ollama call - the LLM is injected via `complete`. Everything else
 * (file enumeration, JSONL parsing, layer writes, SQLite indexing, checkpointing)
 * runs through real code paths.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProjectBinding } from "../../src/core/session.js";
import { type CompleteFn, getAnchorCheckpoint, runExtraction } from "../../src/memory/extractor.js";
import { closeProject, loadProject } from "../../src/projects/loader.js";

const CWD = "/home/sreeni/myp";
const SESSION_DIR_NAME = `--${CWD.replace(/\//g, "-")}--`;

interface PiTurn {
	role: "user" | "assistant";
	text: string;
}

function writeSession(
	sessionsDir: string,
	opts: { id: string; tsIso: string; tsFile: string; turns: PiTurn[] },
) {
	const dir = path.join(sessionsDir, SESSION_DIR_NAME);
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${opts.tsFile}_${opts.id}.jsonl`);
	const events: unknown[] = [
		{ type: "session", version: 3, id: opts.id, timestamp: opts.tsIso, cwd: CWD },
	];
	let i = 0;
	for (const turn of opts.turns) {
		i++;
		events.push({
			type: "message",
			id: `m${i}`,
			timestamp: opts.tsIso,
			message: { role: turn.role, content: [{ type: "text", text: turn.text }] },
		});
	}
	fs.writeFileSync(file, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
	return file;
}

/** Deterministic LLM that emits canned extraction JSON keyed by session id. */
function cannedComplete(byId: Record<string, object>): CompleteFn {
	return async (args) => {
		const idMatch = args.prompt.match(/Session ID: (\S+)/);
		const id = idMatch?.[1] ?? "";
		const payload = byId[id] ?? { decisions: [], thread_updates: [], persona_deltas: [] };
		return { ok: true, text: JSON.stringify(payload) };
	};
}

describe("E2E: nightly extractor lifecycle", () => {
	let sessionsDir: string;
	let projectsDir: string;

	beforeEach(() => {
		sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-e2e-sess-"));
		projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-e2e-proj-"));
	});
	afterEach(() => {
		fs.rmSync(sessionsDir, { recursive: true, force: true });
		fs.rmSync(projectsDir, { recursive: true, force: true });
	});

	it("multi-session lifecycle with incremental runs, failures, dry-run, and recall", async () => {
		// --- Day 1: two sessions ---
		writeSession(sessionsDir, {
			id: "sess-day1-a",
			tsIso: "2026-04-12T09:00:00.000Z",
			tsFile: "2026-04-12T09-00-00-000Z",
			turns: [
				{ role: "user", text: "What auth library should we pick?" },
				{ role: "assistant", text: "Going with grammy because Telegram is in scope." },
			],
		});
		writeSession(sessionsDir, {
			id: "sess-day1-b",
			tsIso: "2026-04-12T15:00:00.000Z",
			tsFile: "2026-04-12T15-00-00-000Z",
			turns: [
				{ role: "user", text: "Locking in SQLite for memory index." },
				{ role: "assistant", text: "Confirmed. Embedded, fast." },
			],
		});

		// --- Night 1: first extraction run ---
		const night1 = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete: cannedComplete({
				"sess-day1-a": {
					decisions: [{ content: "Use grammy for Telegram", tags: ["channels"] }],
					thread_updates: [{ title: "Auth library", summary: "grammy chosen" }],
					persona_deltas: [],
				},
				"sess-day1-b": {
					decisions: [{ content: "SQLite for memory index", tags: ["memory"] }],
					thread_updates: [],
					persona_deltas: [
						{
							field: "tech_preferences",
							delta_type: "add",
							content: "operator prefers embedded DBs",
						},
					],
				},
			}),
		});
		expect(night1.processedSessions).toBe(2);
		expect(night1.decisionsAdded).toBe(2);
		expect(night1.threadsAdded).toBe(1);
		expect(night1.personaDeltasAdded).toBe(1);
		expect(night1.failures).toEqual([]);

		const checkpoint1 = getAnchorCheckpoint(projectsDir);
		expect(checkpoint1?.last_processed_session_id).toBe("sess-day1-b");
		expect(checkpoint1?.last_run_status).toBe("success");

		// --- Day 2: one more session ---
		writeSession(sessionsDir, {
			id: "sess-day2-a",
			tsIso: "2026-04-13T09:00:00.000Z",
			tsFile: "2026-04-13T09-00-00-000Z",
			turns: [
				{ role: "user", text: "Adding extractor cron at 2am." },
				{ role: "assistant", text: "Wired into systemd timer." },
			],
		});

		// --- Night 2: incremental, only the new session ---
		const night2 = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete: cannedComplete({
				"sess-day2-a": {
					decisions: [
						{ content: "Schedule extractor at 02:00 nightly via systemd timer", tags: ["ops"] },
					],
					thread_updates: [],
					persona_deltas: [],
				},
			}),
		});
		expect(night2.processedSessions).toBe(1);
		expect(night2.decisionsAdded).toBe(1);

		// --- Day 3 setup: two more sessions, one will fail at the LLM ---
		writeSession(sessionsDir, {
			id: "sess-day3-good",
			tsIso: "2026-04-14T09:00:00.000Z",
			tsFile: "2026-04-14T09-00-00-000Z",
			turns: [{ role: "user", text: "Successful turn." }],
		});
		writeSession(sessionsDir, {
			id: "sess-day3-bad",
			tsIso: "2026-04-14T10:00:00.000Z",
			tsFile: "2026-04-14T10-00-00-000Z",
			turns: [{ role: "user", text: "This one breaks the LLM." }],
		});

		// --- Night 3: dry-run first (should not write anything) ---
		const dry = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			dryRun: true,
			complete: cannedComplete({
				"sess-day3-good": {
					decisions: [{ content: "Dry-run decision (not persisted)" }],
					thread_updates: [],
					persona_deltas: [],
				},
				"sess-day3-bad": {
					decisions: [{ content: "Dry-run decision 2 (not persisted)" }],
					thread_updates: [],
					persona_deltas: [],
				},
			}),
		});
		expect(dry.dryRun).toBe(true);
		expect(dry.processedSessions).toBe(2);
		// Checkpoint must still point at day-2 session (dry-run does not advance).
		expect(getAnchorCheckpoint(projectsDir)?.last_processed_session_id).toBe("sess-day2-a");

		// --- Night 3 real run: one session fails, the other succeeds ---
		const flaky: CompleteFn = async (args) => {
			if (args.prompt.includes("sess-day3-bad")) {
				return { ok: false, text: "", error: "transient model timeout" };
			}
			return {
				ok: true,
				text: JSON.stringify({
					decisions: [{ content: "Day 3 morning sync" }],
					thread_updates: [],
					persona_deltas: [],
				}),
			};
		};
		const night3 = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete: flaky,
		});
		expect(night3.processedSessions).toBe(1);
		expect(night3.failures).toHaveLength(1);
		expect(night3.failures[0]?.error).toMatch(/transient/);

		const checkpoint3 = getAnchorCheckpoint(projectsDir);
		expect(checkpoint3?.last_run_status).toBe("partial");
		expect(checkpoint3?.last_run_error).toMatch(/transient/);

		// --- Final: recall everything that was extracted across all nights ---
		const binding = getProjectBinding("cli", CWD);
		const project = loadProject(binding, projectsDir);
		try {
			const decisions = project.decisions.readAll();
			expect(decisions.map((d) => d.content)).toEqual(
				expect.arrayContaining([
					"Use grammy for Telegram",
					"SQLite for memory index",
					"Schedule extractor at 02:00 nightly via systemd timer",
					"Day 3 morning sync",
				]),
			);
			expect(decisions).toHaveLength(4);

			const personaDeltas = project.persona.readAll();
			expect(personaDeltas).toHaveLength(1);
			expect(personaDeltas[0]?.field).toBe("tech_preferences");

			const threads = project.threads.readAll();
			expect(threads).toHaveLength(1);
			expect(threads[0]?.title).toBe("Auth library");

			// Recall surfaces results across layers.
			const sqliteRecall = project.memoryQuery.recall({ query: "SQLite" });
			expect(sqliteRecall.some((m) => m.layer === "decisions")).toBe(true);

			const grammyRecall = project.memoryQuery.recall({ query: "grammy" });
			expect(grammyRecall.some((m) => m.layer === "decisions" || m.layer === "threads")).toBe(true);

			const personaRecall = project.memoryQuery.recall({ query: "embedded" });
			expect(personaRecall.some((m) => m.layer === "persona")).toBe(true);
		} finally {
			closeProject(project);
		}
	});
});
