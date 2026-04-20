import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatSynthesisReport, runSynthesis } from "../../src/memory/synthesizer-runner.js";
import { closeProject, loadProject } from "../../src/projects/loader.js";

describe("runSynthesis", () => {
	let projectsDir: string;

	beforeEach(() => {
		projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-synth-runner-"));
	});

	afterEach(() => {
		fs.rmSync(projectsDir, { recursive: true, force: true });
	});

	function seedDuplicates(binding: string): void {
		const p = loadProject(binding, projectsDir);
		p.decisions.addDecision({
			sessionId: "s1",
			project: binding,
			content: "Use SQLite for index",
			confidence: 0.8,
			source: "auto",
			tags: ["arch"],
		});
		p.decisions.addDecision({
			sessionId: "s2",
			project: binding,
			content: "Use  SQLite  for index.",
			confidence: 0.8,
			source: "auto",
			tags: ["storage"],
		});
		p.persona.addDelta({
			sessionId: "s1",
			field: "style",
			deltaType: "add",
			content: "terse",
			confidence: 0.7,
		});
		closeProject(p);
	}

	it("report-only leaves decisions.jsonl untouched", () => {
		seedDuplicates("cli/test-proj");
		const before = fs.readFileSync(
			path.join(projectsDir, "cli/test-proj", "decisions.jsonl"),
			"utf-8",
		);

		const result = runSynthesis({ projectsDir });
		expect(result.projects_scanned).toBe(1);
		expect(result.total_decisions_before).toBe(2);
		expect(result.total_duplicates_removed).toBe(1);
		expect(result.total_deltas_applied).toBe(0);
		expect(result.per_project[0]?.applied).toBe(false);

		const after = fs.readFileSync(
			path.join(projectsDir, "cli/test-proj", "decisions.jsonl"),
			"utf-8",
		);
		expect(after).toBe(before);
	});

	it("apply mode rewrites decisions.jsonl to canonical set", () => {
		seedDuplicates("cli/test-proj");
		const result = runSynthesis({ projectsDir, apply: true });
		expect(result.total_duplicates_removed).toBe(1);
		expect(result.total_deltas_applied).toBe(1);

		const after = fs
			.readFileSync(path.join(projectsDir, "cli/test-proj", "decisions.jsonl"), "utf-8")
			.trim()
			.split("\n");
		expect(after).toHaveLength(1);
		const kept = JSON.parse(after[0] as string);
		expect(kept.content).toContain("SQLite");
		expect(kept.tags.sort()).toEqual(["arch", "storage"]);
	});

	it("scoped to one project when --project given", () => {
		seedDuplicates("cli/proj-a");
		seedDuplicates("cli/proj-b");
		const result = runSynthesis({ projectsDir, project: "cli/proj-a" });
		expect(result.projects_scanned).toBe(1);
		expect(result.per_project[0]?.binding).toBe("cli/proj-a");
	});

	it("formatSynthesisReport produces readable output", () => {
		seedDuplicates("cli/test-proj");
		const result = runSynthesis({ projectsDir });
		const report = formatSynthesisReport(result);
		expect(report).toContain("scanned 1 project");
		expect(report).toContain("cli/test-proj");
		expect(report).toContain("[report-only]");
	});
});
