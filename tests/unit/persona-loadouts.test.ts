import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Redirect ~/.mypensieve to a temp dir BEFORE importing the module under test.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mp-loadouts-"));
const fakeHome = path.join(tmpRoot, "home");
fs.mkdirSync(fakeHome, { recursive: true });
vi.stubEnv("HOME", fakeHome);
const originalHomedir = os.homedir;
(os as { homedir: () => string }).homedir = () => fakeHome;

const { writeConfig } = await import("../../src/config/writer.js");
const schema = await import("../../src/config/schema.js");
const loadouts = await import("../../src/core/persona-loadouts.js");

function baseConfig(): schema.Config {
	return {
		version: 1,
		operator: { name: "Test", timezone: "UTC" },
		tier_routing: { default: "ollama/llama3" },
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
			destinations: [{ type: "local", path: "/tmp/backups" }],
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
		security: { daemon_confirm_policy: "deny" },
	} as schema.Config;
}

function resetHome(): void {
	const mp = path.join(fakeHome, ".mypensieve");
	if (fs.existsSync(mp)) {
		const cfg = path.join(mp, "config.json");
		if (fs.existsSync(cfg)) fs.chmodSync(cfg, 0o644);
		fs.rmSync(mp, { recursive: true, force: true });
	}
}

beforeEach(() => {
	resetHome();
	fs.mkdirSync(path.join(fakeHome, ".mypensieve"), { recursive: true });
});

afterEach(() => {
	resetHome();
});

describe("persona-loadouts", () => {
	it("isValidLoadoutName accepts alnum/dash/underscore, rejects others", () => {
		expect(loadouts.isValidLoadoutName("default")).toBe(true);
		expect(loadouts.isValidLoadoutName("work-mode_2")).toBe(true);
		expect(loadouts.isValidLoadoutName("")).toBe(false);
		expect(loadouts.isValidLoadoutName("../escape")).toBe(false);
		expect(loadouts.isValidLoadoutName("a.b")).toBe(false);
		expect(loadouts.isValidLoadoutName("x".repeat(65))).toBe(false);
	});

	it("creates and lists a loadout", () => {
		loadouts.createLoadout({
			name: "focus",
			identity_prompt: "You are hyper-focused.",
			created_at: new Date().toISOString(),
		});
		const names = loadouts.listLoadoutNames();
		expect(names).toEqual(["focus"]);
		const meta = loadouts.readLoadout("focus");
		expect(meta.identity_prompt).toBe("You are hyper-focused.");
	});

	it("refuses duplicate creates without overwrite", () => {
		loadouts.createLoadout({
			name: "work",
			identity_prompt: "A",
			created_at: "2026-04-20T00:00:00Z",
		});
		expect(() =>
			loadouts.createLoadout({
				name: "work",
				identity_prompt: "B",
				created_at: "2026-04-20T00:00:00Z",
			}),
		).toThrow(/already exists/);
	});

	it("switchLoadout copies identity into config.agent_persona", () => {
		writeConfig(baseConfig());
		loadouts.createLoadout({
			name: "work",
			identity_prompt: "Focused work assistant.",
			personality: "formal",
			created_at: "2026-04-20T00:00:00Z",
		});
		loadouts.switchLoadout("work");
		const cfg = JSON.parse(
			fs.readFileSync(path.join(fakeHome, ".mypensieve", "config.json"), "utf-8"),
		);
		expect(cfg.agent_persona.name).toBe("work");
		expect(cfg.agent_persona.identity_prompt).toBe("Focused work assistant.");
		expect(cfg.agent_persona.personality).toBe("formal");
	});

	it("deleteLoadout refuses the active loadout", () => {
		writeConfig(baseConfig());
		loadouts.createLoadout({
			name: "work",
			identity_prompt: "x",
			created_at: "2026-04-20T00:00:00Z",
		});
		loadouts.switchLoadout("work");
		expect(() => loadouts.deleteLoadout("work")).toThrow(/active/);
	});

	it("deleteLoadout removes a non-active loadout", () => {
		loadouts.createLoadout({
			name: "temp",
			identity_prompt: "x",
			created_at: "2026-04-20T00:00:00Z",
		});
		loadouts.deleteLoadout("temp");
		expect(loadouts.listLoadoutNames()).toEqual([]);
	});

	it("ensureLoadoutsInitialized migrates from config.agent_persona", () => {
		const cfg = baseConfig();
		cfg.agent_persona = {
			name: "Pensieve",
			identity_prompt: "I am Pensieve.",
			created_at: "2026-04-01T00:00:00Z",
		};
		writeConfig(cfg);
		loadouts.ensureLoadoutsInitialized();
		const names = loadouts.listLoadoutNames();
		expect(names).toEqual(["default"]);
		expect(loadouts.readLoadout("default").identity_prompt).toBe("I am Pensieve.");
	});

	it("getActiveLoadoutName matches by identity when loadout exists", () => {
		const cfg = baseConfig();
		cfg.agent_persona = {
			name: "Pensieve",
			identity_prompt: "I am Pensieve.",
			created_at: "2026-04-01T00:00:00Z",
		};
		writeConfig(cfg);
		loadouts.createLoadout({
			name: "default",
			identity_prompt: "I am Pensieve.",
			created_at: "2026-04-01T00:00:00Z",
		});
		loadouts.createLoadout({
			name: "work",
			identity_prompt: "Work mode.",
			created_at: "2026-04-01T00:00:00Z",
		});
		expect(loadouts.getActiveLoadoutName()).toBe("default");
	});
});

afterAll(() => {
	// Restore once at the end of the file - using afterEach here would reset
	// the stub after the first test and break every subsequent test's
	// home-directory redirection.
	(os as { homedir: () => string }).homedir = originalHomedir;
});
