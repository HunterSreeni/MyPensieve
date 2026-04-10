import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProject, closeProject, listProjects } from "../../src/projects/loader.js";

describe("Project loader", () => {
	const tmpDirs: string[] = [];

	function makeTmpDir(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-proj-"));
		tmpDirs.push(dir);
		return dir;
	}

	afterEach(() => {
		for (const dir of tmpDirs) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		tmpDirs.length = 0;
	});

	it("creates project directory and all memory layers", () => {
		const projectsDir = makeTmpDir();
		const project = loadProject("cli/test-project", projectsDir);

		expect(fs.existsSync(project.projectDir)).toBe(true);
		expect(project.binding).toBe("cli/test-project");
		expect(project.decisions).toBeDefined();
		expect(project.threads).toBeDefined();
		expect(project.persona).toBeDefined();
		expect(project.memoryQuery).toBeDefined();
		expect(project.checkpoint).toBeDefined();

		closeProject(project);
	});

	it("creates state subdirectory", () => {
		const projectsDir = makeTmpDir();
		const project = loadProject("cli/test", projectsDir);

		expect(fs.existsSync(path.join(project.projectDir, "state"))).toBe(true);
		closeProject(project);
	});

	it("is idempotent - second load works", () => {
		const projectsDir = makeTmpDir();
		const p1 = loadProject("cli/test", projectsDir);

		// Add a decision
		p1.decisions.addDecision({
			sessionId: "s1", project: "test",
			content: "test decision", confidence: 0.9, source: "manual",
		});
		closeProject(p1);

		// Reload - should find existing data
		const p2 = loadProject("cli/test", projectsDir);
		// Rebuild index from JSONL to verify data persists
		p2.decisions.rebuildIndex();
		const results = p2.decisions.query({});
		expect(results).toHaveLength(1);
		closeProject(p2);
	});

	it("memory query works across layers after load", () => {
		const projectsDir = makeTmpDir();
		const project = loadProject("cli/test", projectsDir);

		project.decisions.addDecision({
			sessionId: "s1", project: "test",
			content: "Use TypeScript for everything", confidence: 0.95, source: "manual",
		});
		project.threads.createThread({
			project: "test", title: "TypeScript vs Go debate",
			firstMessage: { timestamp: "2026-04-10T12:00:00Z", session_id: "s1", role: "operator", content: "discuss" },
		});

		const results = project.memoryQuery.recall({ query: "TypeScript" });
		expect(results.length).toBeGreaterThanOrEqual(2);

		closeProject(project);
	});

	it("SQLite database file is created on disk", () => {
		const projectsDir = makeTmpDir();
		const project = loadProject("cli/test", projectsDir);
		const dbPath = path.join(project.projectDir, "memory-index.db");

		expect(fs.existsSync(dbPath)).toBe(true);
		closeProject(project);
	});
});

describe("listProjects", () => {
	it("lists existing project bindings", () => {
		const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-list-"));
		fs.mkdirSync(path.join(projectsDir, "cli", "project-a"), { recursive: true });
		fs.mkdirSync(path.join(projectsDir, "cli", "project-b"), { recursive: true });
		fs.mkdirSync(path.join(projectsDir, "telegram", "12345"), { recursive: true });

		const projects = listProjects(projectsDir);
		expect(projects).toHaveLength(3);
		expect(projects).toContain("cli/project-a");
		expect(projects).toContain("cli/project-b");
		expect(projects).toContain("telegram/12345");

		fs.rmSync(projectsDir, { recursive: true, force: true });
	});

	it("returns empty for nonexistent dir", () => {
		expect(listProjects("/nonexistent/projects")).toEqual([]);
	});
});
