import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// We need to mock the paths before importing the module
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-dirs-test-"));
const mypensieveDir = path.join(tmpHome, ".mypensieve");
const secretsDir = path.join(mypensieveDir, ".secrets");

vi.mock("../../src/config/paths.js", () => {
	const piDir = path.join(tmpHome, ".pi", "agent");
	return {
		MYPENSIEVE_DIR: mypensieveDir,
		CONFIG_PATH: path.join(mypensieveDir, "config.json"),
		SECRETS_DIR: secretsDir,
		DIRS: {
			root: mypensieveDir,
			projects: path.join(mypensieveDir, "projects"),
			logs: path.join(mypensieveDir, "logs"),
			logsErrors: path.join(mypensieveDir, "logs", "errors"),
			logsCost: path.join(mypensieveDir, "logs", "cost"),
			logsCron: path.join(mypensieveDir, "logs", "cron"),
			state: path.join(mypensieveDir, "state"),
			stateReminders: path.join(mypensieveDir, "state", "reminders"),
			secrets: secretsDir,
			metaSkills: path.join(mypensieveDir, "meta-skills"),
		},
		PI_DIRS: {
			root: piDir,
			extensions: path.join(piDir, "extensions"),
			mypensieveExtensions: path.join(piDir, "extensions", "mypensieve"),
			agents: path.join(piDir, "agents"),
			skills: path.join(piDir, "skills"),
			sessions: path.join(piDir, "sessions"),
			auth: path.join(piDir, "auth.json"),
		},
		INIT_PROGRESS_PATH: path.join(mypensieveDir, ".init-progress.json"),
	};
});

const { scaffoldDirectories, verifyDirectories } = await import("../../src/init/directories.js");

describe("Directory scaffold", () => {
	afterEach(() => {
		fs.rmSync(tmpHome, { recursive: true, force: true });
		fs.mkdirSync(tmpHome, { recursive: true });
	});

	it("creates all required directories", () => {
		const result = scaffoldDirectories();
		expect(result.created.length).toBeGreaterThan(0);
		expect(result.existed).toHaveLength(0);
	});

	it("is idempotent - second run reports existed", () => {
		scaffoldDirectories();
		const result2 = scaffoldDirectories();
		expect(result2.existed.length).toBeGreaterThan(0);
		expect(result2.created).toHaveLength(0);
	});

	it("sets secrets dir to mode 0700", () => {
		scaffoldDirectories();
		const stats = fs.statSync(secretsDir);
		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o700);
	});

	it("fixes secrets dir permissions on re-run", () => {
		scaffoldDirectories();
		fs.chmodSync(secretsDir, 0o755);
		scaffoldDirectories();
		const stats = fs.statSync(secretsDir);
		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o700);
	});
});

describe("Directory verification", () => {
	afterEach(() => {
		fs.rmSync(tmpHome, { recursive: true, force: true });
		fs.mkdirSync(tmpHome, { recursive: true });
	});

	it("reports ok when all dirs exist", () => {
		scaffoldDirectories();
		const result = verifyDirectories();
		expect(result.ok).toBe(true);
		expect(result.issues).toHaveLength(0);
	});

	it("reports missing directories", () => {
		const result = verifyDirectories();
		expect(result.ok).toBe(false);
		expect(result.issues.length).toBeGreaterThan(0);
		expect(result.issues[0]).toContain("Missing directory");
	});

	it("reports wrong permissions on secrets dir", () => {
		scaffoldDirectories();
		fs.chmodSync(secretsDir, 0o755);
		const result = verifyDirectories();
		expect(result.ok).toBe(false);
		expect(result.issues.some((i) => i.includes("wrong permissions"))).toBe(true);
	});
});
