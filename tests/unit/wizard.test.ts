import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wizard-test-"));

vi.mock("../../src/config/paths.js", () => {
	const tmpBase = path.join(os.tmpdir(), "wizard-test-mock");
	fs.mkdirSync(tmpBase, { recursive: true });
	return {
		INIT_PROGRESS_PATH: path.join(tmpBase, ".init-progress.json"),
		MYPENSIEVE_DIR: path.join(tmpBase, ".mypensieve"),
		CONFIG_PATH: path.join(tmpBase, ".mypensieve", "config.json"),
		SECRETS_DIR: path.join(tmpBase, ".mypensieve", ".secrets"),
		DIRS: {
			root: path.join(tmpBase, ".mypensieve"),
			projects: path.join(tmpBase, ".mypensieve", "projects"),
			logs: path.join(tmpBase, ".mypensieve", "logs"),
			logsErrors: path.join(tmpBase, ".mypensieve", "logs", "errors"),
			logsCost: path.join(tmpBase, ".mypensieve", "logs", "cost"),
			logsCron: path.join(tmpBase, ".mypensieve", "logs", "cron"),
			state: path.join(tmpBase, ".mypensieve", "state"),
			stateReminders: path.join(tmpBase, ".mypensieve", "state", "reminders"),
			secrets: path.join(tmpBase, ".mypensieve", ".secrets"),
			metaSkills: path.join(tmpBase, ".mypensieve", "meta-skills"),
		},
		PI_DIRS: {
			root: path.join(tmpBase, ".pi", "agent"),
			extensions: path.join(tmpBase, ".pi", "agent", "extensions"),
			mypensieveExtensions: path.join(tmpBase, ".pi", "agent", "extensions", "mypensieve"),
			agents: path.join(tmpBase, ".pi", "agent", "agents"),
			skills: path.join(tmpBase, ".pi", "agent", "skills"),
			sessions: path.join(tmpBase, ".pi", "agent", "sessions"),
			auth: path.join(tmpBase, ".pi", "agent", "auth.json"),
		},
	};
});

const { runWizard, readProgress, saveProgress } = await import("../../src/wizard/framework.js");
const { createWizardSteps } = await import("../../src/wizard/steps.js");
import type { WizardStep } from "../../src/wizard/framework.js";

describe("Wizard framework", () => {
	it("runs all steps sequentially", async () => {
		const stepLog: string[] = [];
		const steps: WizardStep[] = [
			{ name: "a", description: "Step A", run: async () => { stepLog.push("a"); } },
			{ name: "b", description: "Step B", run: async () => { stepLog.push("b"); } },
			{ name: "c", description: "Step C", run: async () => { stepLog.push("c"); } },
		];

		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runWizard(steps);
		spy.mockRestore();

		expect(stepLog).toEqual(["a", "b", "c"]);
	});

	it("resumes from last completed step", async () => {
		const stepLog: string[] = [];

		saveProgress({
			completedSteps: [0],
			state: { step0_done: true },
			lastUpdated: new Date().toISOString(),
		});

		const steps: WizardStep[] = [
			{ name: "a", description: "A", run: async () => { stepLog.push("a"); } },
			{ name: "b", description: "B", run: async () => { stepLog.push("b"); } },
			{ name: "c", description: "C", run: async () => { stepLog.push("c"); } },
		];

		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const state = await runWizard(steps);
		spy.mockRestore();

		expect(stepLog).toEqual(["b", "c"]);
		expect(state.config.step0_done).toBe(true);
	});

	it("restart ignores previous progress", async () => {
		const stepLog: string[] = [];

		saveProgress({
			completedSteps: [0, 1],
			state: {},
			lastUpdated: new Date().toISOString(),
		});

		const steps: WizardStep[] = [
			{ name: "a", description: "A", run: async () => { stepLog.push("a"); } },
			{ name: "b", description: "B", run: async () => { stepLog.push("b"); } },
		];

		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runWizard(steps, { restart: true });
		spy.mockRestore();

		expect(stepLog).toEqual(["a", "b"]);
	});

	it("progress is cleared after completion", async () => {
		const steps: WizardStep[] = [
			{ name: "a", description: "A", run: async () => {} },
		];

		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await runWizard(steps);
		spy.mockRestore();

		expect(readProgress()).toBeNull();
	});
});

describe("Wizard steps", () => {
	it("creates 9 steps", () => {
		const steps = createWizardSteps();
		expect(steps).toHaveLength(9);
	});

	it("steps have correct names", () => {
		const steps = createWizardSteps();
		const names = steps.map((s) => s.name);
		expect(names).toEqual([
			"welcome", "project", "providers", "routing",
			"embeddings", "channels", "persona", "review", "initialize",
		]);
	});
});
