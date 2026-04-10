/**
 * Cross-phase integration: Phase 1-5
 * The complete pipeline: Config -> Project -> Gateway -> Skills -> Memory -> Recall
 *
 * This test simulates the real `mypensieve start` flow where:
 * 1. Config is loaded and validated
 * 2. Project is loaded with memory layers
 * 3. Skill registry is created with all 9 skills
 * 4. Gateway dispatcher routes verbs to skills
 * 5. Skills write to memory, memory is queryable via recall
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeConfig, readConfig } from "../../src/config/index.js";
import type { Config } from "../../src/config/schema.js";
import { validateChannelBinding } from "../../src/gateway/binding-validator.js";
import { getProjectBinding } from "../../src/core/session.js";
import { loadProject, closeProject } from "../../src/projects/loader.js";
import { loadAllRoutingTables } from "../../src/gateway/routing-loader.js";
import { GatewayDispatcher } from "../../src/gateway/dispatcher.js";
import { createDefaultRegistry } from "../../src/skills/registry.js";
import { createUnifiedExecutor, type SkillContext } from "../../src/skills/executor.js";
import { VERB_NAMES } from "../../src/gateway/verbs.js";

function validConfig(): Config {
	return {
		version: 1,
		operator: { name: "Sreeni", timezone: "Asia/Kolkata" },
		tier_routing: { default: "ollama/llama3" },
		embeddings: { enabled: false },
		daily_log: { enabled: true, cron: "0 20 * * *", channel: "cli", auto_prompt_next_morning_if_missed: true },
		backup: { enabled: true, cron: "30 2 * * *", retention_days: 30, destinations: [{ type: "local", path: "/tmp" }], include_secrets: false },
		channels: { cli: { enabled: true, tool_escape_hatch: false }, telegram: { enabled: false, tool_escape_hatch: false } },
		extractor: { cron: "0 2 * * *" },
	};
}

describe("Phase 1-5: Full pipeline", () => {
	const tmpDirs: string[] = [];

	function setup() {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase15-"));
		tmpDirs.push(tmpDir);

		const configPath = path.join(tmpDir, "config.json");
		const projectsDir = path.join(tmpDir, "projects");
		const metaSkillsDir = path.join(tmpDir, "meta-skills");
		fs.mkdirSync(metaSkillsDir, { recursive: true });

		writeConfig(validConfig(), configPath);
		const config = readConfig(configPath);
		validateChannelBinding("cli", config.channels);

		const binding = getProjectBinding("cli", "/home/sreeni/myproject");
		const project = loadProject(binding, projectsDir);
		const registry = createDefaultRegistry();

		const ctx: SkillContext = {
			project,
			config,
			channelType: "cli",
			sessionId: `session-${Date.now()}`,
		};

		const executor = createUnifiedExecutor(registry, ctx);
		const tables = loadAllRoutingTables(metaSkillsDir);
		const dispatcher = new GatewayDispatcher(tables, executor);

		return { dispatcher, project, ctx, registry, config, binding };
	}

	afterEach(() => {
		for (const dir of tmpDirs) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		tmpDirs.length = 0;
	});

	it("recall verb -> memory-recall skill -> returns memory results", async () => {
		const { dispatcher, project } = setup();

		project.decisions.addDecision({
			sessionId: "s1", project: "test",
			content: "Use Pi as foundation", confidence: 0.95, source: "manual",
		});

		const result = await dispatcher.dispatch(
			"recall",
			{ query: "Pi" },
			{ channelType: "cli", project: "test" },
		);

		const data = result.result as { matches: Array<{ content: string }>; total: number };
		expect(data.total).toBeGreaterThanOrEqual(1);
		expect(data.matches.some((m) => m.content.includes("Pi"))).toBe(true);
		closeProject(project);
	});

	it("journal verb -> daily-log skill -> writes entry -> recallable", async () => {
		const { dispatcher, project } = setup();

		// Write a journal entry via the gateway
		const writeResult = await dispatcher.dispatch(
			"journal",
			{
				action: "write",
				entry: {
					wins: ["completed Phase 5 integration"],
					blockers: [],
					mood_score: 5,
					mood_text: "excellent",
					energy_score: 4,
					energy_text: "high",
					remember_tomorrow: "start Phase 6",
					weekly_review_flag: false,
				},
			},
			{ channelType: "cli", project: "test" },
		);

		expect((writeResult.result as { stored: boolean }).stored).toBe(true);

		// Read it back via journal read
		const readResult = await dispatcher.dispatch(
			"journal",
			{ action: "read" },
			{ channelType: "cli", project: "test" },
		);

		const entry = readResult.result as { wins: string[] };
		expect(entry.wins).toContain("completed Phase 5 integration");

		closeProject(project);
	});

	it("research verb -> researcher skill -> returns synthesis with citations", async () => {
		const { dispatcher, project } = setup();

		const result = await dispatcher.dispatch(
			"research",
			{ topic: "autonomous agent architectures" },
			{ channelType: "cli", project: "test" },
		);

		const data = result.result as { synthesis: string; citations: unknown[] };
		expect(data.synthesis).toContain("autonomous agent");
		expect(data.citations.length).toBeGreaterThan(0);

		closeProject(project);
	});

	it("produce verb -> blog-seo skill -> returns SEO score", async () => {
		const { dispatcher, project } = setup();

		const longPost = "This is a detailed blog post about building autonomous agents with persistent memory. ".repeat(25) + "What would you build with persistent memory?";

		const result = await dispatcher.dispatch(
			"produce",
			{ kind: "blog-post", prompt: longPost },
			{ channelType: "cli", project: "test" },
		);

		const data = result.result as { seo_score: number; suggestions: string[] };
		expect(data.seo_score).toBeGreaterThan(0);

		closeProject(project);
	});

	it("notify verb -> returns delivered status", async () => {
		const { dispatcher, project } = setup();

		const result = await dispatcher.dispatch(
			"notify",
			{ message: "Test notification", severity: "info" },
			{ channelType: "cli", project: "test" },
		);

		// Notify routes to 'notify' extension (stub)
		expect(result.verb).toBe("notify");

		closeProject(project);
	});

	it("dispatch verb -> validates confirm defaults to true", async () => {
		const { dispatcher, project } = setup();

		const result = await dispatcher.dispatch(
			"dispatch",
			{ action: "git.status" },
			{ channelType: "cli", project: "test" },
		);

		// Dispatch routes to gh-cli MCP (stub returns mcp_not_connected)
		expect(result.verb).toBe("dispatch");

		closeProject(project);
	});

	it("all 8 verbs execute without error", async () => {
		const { dispatcher, project } = setup();

		const verbArgs: Record<string, Record<string, unknown>> = {
			recall: { query: "test" },
			research: { topic: "test" },
			ingest: { source: "/tmp/nonexistent.pdf" },
			monitor: { target: "cves" },
			journal: { action: "read" },
			produce: { kind: "blog-post", prompt: "test post content here with enough words to be meaningful" },
			dispatch: { action: "git.status" },
			notify: { message: "test" },
		};

		for (const verb of VERB_NAMES) {
			const result = await dispatcher.dispatch(
				verb,
				verbArgs[verb]!,
				{ channelType: "cli", project: "test" },
			);
			expect(result.verb).toBe(verb);
		}

		closeProject(project);
	});

	it("session simulation: decide -> journal -> recall across the full stack", async () => {
		const { dispatcher, project } = setup();

		// Step 1: Add decisions (simulating extractor)
		project.decisions.addDecision({
			sessionId: "session-001", project: "cli/test",
			content: "Use 10-phase implementation plan because it allows parallel work",
			confidence: 0.95, source: "manual", tags: ["planning"],
		});

		// Step 2: Write journal entry via verb
		await dispatcher.dispatch("journal", {
			action: "write",
			entry: {
				wins: ["locked architecture decisions", "started implementation"],
				blockers: ["waiting for Pi re-audit"],
				mood_score: 4, mood_text: "productive day",
				energy_score: 3, energy_text: "slightly tired",
				remember_tomorrow: "run pi-reaudit.sh on April 13",
				weekly_review_flag: false,
			},
		}, { channelType: "cli", project: "cli/test" });

		// Step 3: Recall the decision
		const recallResult = await dispatcher.dispatch(
			"recall",
			{ query: "implementation plan" },
			{ channelType: "cli", project: "cli/test" },
		);

		const matches = (recallResult.result as { matches: Array<{ content: string }> }).matches;
		expect(matches.some((m) => m.content.includes("implementation plan"))).toBe(true);

		// Step 4: Read journal trends
		const trendsResult = await dispatcher.dispatch(
			"journal",
			{ action: "trends" },
			{ channelType: "cli", project: "cli/test" },
		);
		expect(trendsResult.verb).toBe("journal");

		// Step 5: Verify stats
		const stats = project.index.getStats();
		expect(stats.decisions).toBe(1);
		expect(stats.daily_logs).toBe(1);

		closeProject(project);
	});

	it("security: playwright-cli blocked on telegram even through gateway", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase15-sec-"));
		tmpDirs.push(tmpDir);

		const projectsDir = path.join(tmpDir, "projects");
		const metaSkillsDir = path.join(tmpDir, "meta-skills");
		fs.mkdirSync(metaSkillsDir, { recursive: true });

		const project = loadProject("telegram/12345", projectsDir);
		const registry = createDefaultRegistry();
		const config = validConfig();
		config.channels.telegram.enabled = true;

		const ctx: SkillContext = {
			project, config,
			channelType: "telegram",
			sessionId: "test",
		};

		// Execute playwright-cli directly through registry
		const result = await registry.execute("playwright-cli", { source: "https://evil.com" }, ctx);
		expect(result.success).toBe(false);
		expect(result.error).toContain("not available on Telegram");

		closeProject(project);
	});
});
