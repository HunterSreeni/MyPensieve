import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/**
 * Phase 10: Full MVP integration test.
 *
 * Tests the complete lifecycle:
 *   Wizard -> Config -> Project -> Memory -> Gateway -> Skills -> Recall
 *   -> Journal -> Council -> Telegram session isolation
 *
 * This is the "can we ship?" test.
 */
import { afterEach, describe, expect, it } from "vitest";

import { chunkMessage } from "../../src/channels/telegram/formatter.js";
import { PeerSessionManager } from "../../src/channels/telegram/sessions.js";
import { type Config, readConfig, writeConfig } from "../../src/config/index.js";
import { getProjectBinding } from "../../src/core/session.js";
import { type AgentPersona, CouncilManager } from "../../src/council/manager.js";
import { validateChannelBinding } from "../../src/gateway/binding-validator.js";
import { GatewayDispatcher } from "../../src/gateway/dispatcher.js";
import { loadAllRoutingTables } from "../../src/gateway/routing-loader.js";
import { VERB_NAMES } from "../../src/gateway/verbs.js";
import { scaffoldDirectories, verifyDirectories } from "../../src/init/directories.js";
import { CheckpointManager } from "../../src/memory/checkpoint.js";
import { pruneBackups } from "../../src/ops/backup/engine.js";
import { CircuitBreakerRegistry } from "../../src/ops/errors/circuit-breaker.js";
import { ErrorDedup } from "../../src/ops/errors/dedup.js";
import { closeProject, listProjects, loadProject } from "../../src/projects/loader.js";
import { type SkillContext, createUnifiedExecutor } from "../../src/skills/executor.js";
import { createDefaultRegistry } from "../../src/skills/registry.js";

function validConfig(): Config {
	return {
		version: 1,
		operator: { name: "Sreeni", timezone: "Asia/Kolkata" },
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
			destinations: [{ type: "local", path: "/tmp/mypensieve-backups" }],
			include_secrets: false,
		},
		channels: {
			cli: { enabled: true, tool_escape_hatch: false },
			telegram: {
				enabled: true,
				tool_escape_hatch: false,
				allowed_peers: ["456789"],
				allow_groups: false,
			},
		},
		extractor: { cron: "0 2 * * *" },
	};
}

function setupFullStack(tmpDir: string) {
	const configPath = path.join(tmpDir, "config.json");
	const projectsDir = path.join(tmpDir, "projects");
	const metaSkillsDir = path.join(tmpDir, "meta-skills");
	fs.mkdirSync(metaSkillsDir, { recursive: true });

	writeConfig(validConfig(), configPath);
	const config = readConfig(configPath);

	const binding = getProjectBinding("cli", "/home/sreeni/MyPensieve");
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

	return { dispatcher, project, config, binding, registry, ctx, configPath, projectsDir };
}

describe("Phase 10: Full MVP Integration", () => {
	const tmpDirs: string[] = [];
	function makeTmpDir() {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phase-all-"));
		tmpDirs.push(dir);
		return dir;
	}
	afterEach(() => {
		for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
		tmpDirs.length = 0;
	});

	it("complete session lifecycle: decide -> journal -> council -> recall", async () => {
		const { dispatcher, project, config } = setupFullStack(makeTmpDir());

		// 1. Add decisions
		project.decisions.addDecision({
			sessionId: "s1",
			project: project.binding,
			content: "Use Pi as foundation because it covers 70% of our needs",
			confidence: 0.95,
			source: "manual",
			tags: ["architecture"],
		});
		project.decisions.addDecision({
			sessionId: "s1",
			project: project.binding,
			content: "Ship CLI + Telegram in MVP, defer Discord",
			confidence: 0.95,
			source: "manual",
			tags: ["scope"],
		});

		// 2. Journal entry via verb
		const journalResult = await dispatcher.dispatch(
			"journal",
			{
				action: "write",
				entry: {
					wins: ["locked all architecture decisions", "built 10-phase plan"],
					blockers: ["waiting for Pi re-audit on April 13"],
					mood_score: 5,
					mood_text: "on fire",
					energy_score: 4,
					energy_text: "strong",
					remember_tomorrow: "run pi-reaudit.sh",
					weekly_review_flag: false,
				},
			},
			{ channelType: "cli", project: project.binding },
		);
		expect((journalResult.result as { stored: boolean }).stored).toBe(true);

		// 3. Research via verb
		const researchResult = await dispatcher.dispatch(
			"research",
			{
				topic: "autonomous agent memory architectures",
			},
			{ channelType: "cli", project: project.binding },
		);
		const research = researchResult.result as { synthesis: string; citations: unknown[] };
		expect(research.synthesis.length).toBeGreaterThan(0);

		// 4. Council deliberation
		const council = new CouncilManager({
			topic: "Should we use SQLite or Redis for the memory index?",
			agents: [
				{
					name: "researcher",
					description: "Gathers data",
					model: "openrouter/minimax-m2.7",
					canBeConvened: true,
					systemPrompt: "Research",
				},
				{
					name: "critic",
					description: "Challenges",
					model: "openrouter/kimi-k2",
					canBeConvened: true,
					systemPrompt: "Critique",
				},
				{
					name: "orchestrator",
					description: "Synthesizes",
					model: "anthropic/claude-sonnet-4-6",
					canBeConvened: true,
					systemPrompt: "Synthesize",
				},
			],
			speakerMode: "round_robin",
			maxRounds: 9,
		});
		const councilResult = await council.deliberate();
		expect(councilResult.phases_completed).toBe(3);
		expect(councilResult.agents).toHaveLength(3);

		// 5. Recall decisions (search by content that exists)
		const recallResult = await dispatcher.dispatch(
			"recall",
			{
				query: "foundation",
			},
			{ channelType: "cli", project: project.binding },
		);
		const matches = (recallResult.result as { matches: Array<{ content: string }> }).matches;
		expect(matches.length).toBeGreaterThan(0);

		// 6. Verify stats
		const stats = project.index.getStats();
		expect(stats.decisions).toBe(2);
		expect(stats.daily_logs).toBe(1);

		closeProject(project);
	});

	it("CLI + Telegram isolation: decisions don't cross channels", async () => {
		const tmpDir = makeTmpDir();
		const projectsDir = path.join(tmpDir, "projects");

		// CLI session
		const cliProject = loadProject("cli/project-a", projectsDir);
		cliProject.decisions.addDecision({
			sessionId: "s1",
			project: "cli/project-a",
			content: "CLI secret decision about auth",
			confidence: 0.95,
			source: "manual",
		});

		// Telegram session
		const config = validConfig();
		const telegramManager = new PeerSessionManager(config, { projectsDir, timeoutMs: 30000 });
		const telegramSession = telegramManager.getOrCreate("456789");
		telegramSession.project.decisions.addDecision({
			sessionId: "s2",
			project: telegramSession.binding,
			content: "Telegram public decision",
			confidence: 0.95,
			source: "manual",
		});

		// CLI recall should not see Telegram data
		const cliRecall = cliProject.memoryQuery.recall({
			query: "decision",
			project: "cli/project-a",
		});
		expect(cliRecall.every((m) => !m.content.includes("Telegram"))).toBe(true);

		// Telegram recall should not see CLI data
		const telegramRecall = telegramSession.project.memoryQuery.recall({
			query: "decision",
			project: telegramSession.binding,
		});
		expect(telegramRecall.every((m) => !m.content.includes("CLI secret"))).toBe(true);

		closeProject(cliProject);
		telegramManager.closeAll();
	});

	it("all 8 verbs execute end-to-end without errors", async () => {
		const { dispatcher, project } = setupFullStack(makeTmpDir());

		const verbArgs: Record<string, Record<string, unknown>> = {
			recall: { query: "anything" },
			research: { topic: "AI" },
			ingest: { source: "/tmp/test.pdf" },
			monitor: { target: "cves" },
			journal: { action: "read" },
			produce: { kind: "text", prompt: "test content" },
			dispatch: { action: "git.status" },
			notify: { message: "test notification" },
		};

		for (const verb of VERB_NAMES) {
			const result = await dispatcher.dispatch(verb, verbArgs[verb]!, {
				channelType: "cli",
				project: project.binding,
			});
			expect(result.verb).toBe(verb);
			expect(result.target).toBeDefined();
		}

		closeProject(project);
	});

	it("error dedup + circuit breaker work together", () => {
		const dedup = new ErrorDedup();
		const registry = new CircuitBreakerRegistry();
		const breaker = registry.get("mcp:test", { failureThreshold: 3 });

		// Simulate 5 rapid failures
		for (let i = 0; i < 5; i++) {
			const { shouldSurface } = dedup.record({
				id: `err-${i}`,
				timestamp: new Date().toISOString(),
				severity: "high",
				error_type: "mcp_crash",
				error_src: "test-mcp",
				message: "Connection refused",
				context: {},
				resolved: false,
				retry_count: 0,
			});

			breaker.recordFailure();

			if (i === 0) expect(shouldSurface).toBe(true);
			else expect(shouldSurface).toBe(false); // deduped
		}

		// Circuit breaker should be open after 5 failures (threshold 3)
		expect(breaker.getState().status).toBe("open");
		expect(breaker.canExecute()).toBe(false);

		// Registry tracks it
		expect(registry.getOpen()).toHaveLength(1);
	});

	it("telegram messages are chunked correctly", () => {
		const longMessage = "A".repeat(10000);
		const chunks = chunkMessage(longMessage);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(4096);
		}
	});

	it("checkpoint survives across project reload", () => {
		const tmpDir = makeTmpDir();
		const projectsDir = path.join(tmpDir, "projects");

		// Session 1: write checkpoint
		const p1 = loadProject("cli/test", projectsDir);
		p1.checkpoint.write({
			last_processed_session_id: "session-042",
			last_processed_timestamp: new Date().toISOString(),
			total_sessions_processed: 42,
			last_run_status: "success",
		});
		closeProject(p1);

		// Session 2: read checkpoint
		const p2 = loadProject("cli/test", projectsDir);
		expect(p2.checkpoint.isProcessed("session-042")).toBe(true);
		expect(p2.checkpoint.isProcessed("session-043")).toBe(false);
		closeProject(p2);
	});

	it("multiple projects coexist without interference", () => {
		const tmpDir = makeTmpDir();
		const projectsDir = path.join(tmpDir, "projects");

		const projects = ["cli/alpha", "cli/beta", "telegram/123"].map((b) =>
			loadProject(b, projectsDir),
		);

		// Each project gets its own decision
		projects.forEach((p, i) => {
			p.decisions.addDecision({
				sessionId: "s1",
				project: p.binding,
				content: `Decision ${i} for ${p.binding}`,
				confidence: 0.95,
				source: "manual",
			});
		});

		// Each project should only see its own
		projects.forEach((p, i) => {
			const results = p.decisions.query({ project: p.binding });
			expect(results).toHaveLength(1);
			expect(results[0]?.content).toContain(`Decision ${i}`);
		});

		// List projects
		const listed = listProjects(projectsDir);
		expect(listed).toHaveLength(3);

		projects.forEach((p) => closeProject(p));
	});

	it("wizard creates correct 9-step structure", async () => {
		const { createWizardSteps } = await import("../../src/wizard/steps.js");
		const steps = createWizardSteps();
		expect(steps).toHaveLength(9);
		expect(steps.map((s: { name: string }) => s.name)).toEqual([
			"welcome",
			"providers",
			"routing",
			"embeddings",
			"channels",
			"persona",
			"agent_identity",
			"review",
			"initialize",
		]);
	});

	it("default skill registry has all MVP skills", () => {
		const registry = createDefaultRegistry();
		expect(registry.list()).toHaveLength(10);
		expect(registry.has("daily-log")).toBe(true);
		expect(registry.has("memory-recall")).toBe(true);
		expect(registry.has("memory-extract")).toBe(true);
		expect(registry.has("researcher")).toBe(true);
		expect(registry.has("cve-monitor")).toBe(true);
		expect(registry.has("blog-seo")).toBe(true);
		expect(registry.has("playwright-cli")).toBe(true);
		expect(registry.has("image-edit")).toBe(true);
		expect(registry.has("video-edit")).toBe(true);
		expect(registry.has("audio-edit")).toBe(true);
	});
});
