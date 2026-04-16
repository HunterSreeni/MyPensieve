/**
 * Integration test: extractor → layers → MemoryQuery.recall round-trip.
 *
 * Feeds a synthetic Pi session through the extractor (LLM mocked, real layers),
 * then queries via MemoryQuery to ensure decisions / threads / persona deltas
 * are persisted, indexed in SQLite, and recallable across all three layers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProjectBinding } from "../../src/core/session.js";
import { type CompleteFn, runExtraction } from "../../src/memory/extractor.js";
import { closeProject, loadProject } from "../../src/projects/loader.js";

function writePiSession(sessionsDir: string, opts: { id: string; cwd: string }) {
	const slug = opts.cwd.replace(/\//g, "-");
	const dir = path.join(sessionsDir, `--${slug}--`);
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `2026-04-13T10-00-00-000Z_${opts.id}.jsonl`);
	const lines = [
		{
			type: "session",
			version: 3,
			id: opts.id,
			timestamp: "2026-04-13T10:00:00.000Z",
			cwd: opts.cwd,
		},
		{
			type: "message",
			id: "u",
			timestamp: "2026-04-13T10:00:00.000Z",
			message: {
				role: "user",
				content: [{ type: "text", text: "Let's pick the memory backend for MyPensieve." }],
			},
		},
		{
			type: "message",
			id: "a",
			timestamp: "2026-04-13T10:00:01.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Going with SQLite for the index." }],
			},
		},
	];
	fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
	return file;
}

describe("extractor → recall integration", () => {
	let sessionsDir: string;
	let projectsDir: string;

	beforeEach(() => {
		sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-int-sess-"));
		projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-int-proj-"));
	});
	afterEach(() => {
		fs.rmSync(sessionsDir, { recursive: true, force: true });
		fs.rmSync(projectsDir, { recursive: true, force: true });
	});

	it("extracted records are recallable through MemoryQuery", async () => {
		writePiSession(sessionsDir, { id: "intg-1", cwd: "/home/test/myp" });

		const complete: CompleteFn = async () => ({
			ok: true,
			text: JSON.stringify({
				decisions: [
					{
						content: "Use SQLite as memory index because it is embedded and fast",
						tags: ["architecture"],
					},
				],
				thread_updates: [
					{ title: "Memory backend choice", summary: "Discussion about SQLite vs Postgres" },
				],
				persona_deltas: [
					{
						field: "tech_preferences",
						delta_type: "add",
						content: "operator prefers embedded databases",
					},
				],
			}),
		});

		const result = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete,
		});
		expect(result.processedSessions).toBe(1);

		const binding = getProjectBinding("cli", "/home/test/myp");
		const project = loadProject(binding, projectsDir);
		try {
			// Layer-level checks (source of truth + SQLite index)
			expect(project.decisions.readAll()).toHaveLength(1);
			expect(project.threads.readAll()).toHaveLength(1);
			expect(project.persona.readAll()).toHaveLength(1);

			// Unified recall hits all three layers
			const matches = project.memoryQuery.recall({ query: "SQLite" });
			const layers = new Set(matches.map((m) => m.layer));
			expect(layers.has("decisions")).toBe(true);
			expect(layers.has("threads")).toBe(true);

			const personaMatches = project.memoryQuery.recall({ query: "embedded" });
			expect(personaMatches.some((m) => m.layer === "persona")).toBe(true);

			// Auto extraction stamps confidence at 0.65
			const decisionMatch = matches.find((m) => m.layer === "decisions");
			expect(decisionMatch?.confidence).toBeCloseTo(0.65, 5);
			expect(decisionMatch?.source).toBe("auto");
		} finally {
			closeProject(project);
		}
	});

	it("empty LLM output produces zero records but advances checkpoint", async () => {
		writePiSession(sessionsDir, { id: "intg-empty", cwd: "/home/test/myp" });
		const complete: CompleteFn = async () => ({
			ok: true,
			text: JSON.stringify({ decisions: [], thread_updates: [], persona_deltas: [] }),
		});

		const result = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete,
		});
		expect(result.processedSessions).toBe(1);
		expect(result.decisionsAdded).toBe(0);
		expect(result.threadsAdded).toBe(0);
		expect(result.personaDeltasAdded).toBe(0);

		// Re-run produces nothing because checkpoint advanced.
		const second = await runExtraction({
			model: "ollama/test-model",
			sessionsDir,
			projectsDir,
			complete,
		});
		expect(second.processedSessions).toBe(0);
	});
});
