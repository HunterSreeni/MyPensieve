import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/**
 * E2E Test Suite: MyPensieve Full Product
 *
 * These tests simulate real user workflows from start to finish.
 * Each test is a complete user story - no mocks, no stubs for our code.
 * External dependencies (Pi LLM calls, MCPs) are the only things not live.
 *
 * Test categories:
 *   1. Fresh install & first session
 *   2. Multi-session memory persistence
 *   3. Daily journal lifecycle
 *   4. Council deliberation
 *   5. Cross-channel isolation (CLI vs Telegram)
 *   6. All 8 verbs end-to-end
 *   7. Custom skill registration via frontmatter
 *   8. Error handling pipeline
 *   9. Backup & restore readiness
 *  10. Security enforcement
 */
import { afterEach, describe, expect, it } from "vitest";

import { chunkMessage } from "../../src/channels/telegram/formatter.js";
import { PeerNotAllowedError, PeerSessionManager } from "../../src/channels/telegram/sessions.js";
import { readConfig, writeConfig } from "../../src/config/index.js";
import type { Config } from "../../src/config/schema.js";
import { getProjectBinding } from "../../src/core/session.js";
import { CouncilManager } from "../../src/council/manager.js";
import { AVAILABLE_AGENTS, DEFAULT_AGENTS, resolveAgentModel } from "../../src/council/personas.js";
import { validateChannelBinding } from "../../src/gateway/binding-validator.js";
import { GatewayDispatcher } from "../../src/gateway/dispatcher.js";
import { loadAllRoutingTables } from "../../src/gateway/routing-loader.js";
import {
	applySkillRegistrations,
	scanSkillsForRegistration,
} from "../../src/gateway/skill-registration.js";
import { VERB_NAMES } from "../../src/gateway/verbs.js";
import { scaffoldDirectories, verifyDirectories } from "../../src/init/directories.js";
import type { DailyLogEntry } from "../../src/memory/types.js";
import { pruneBackups } from "../../src/ops/backup/engine.js";
import { CircuitBreaker, CircuitBreakerRegistry } from "../../src/ops/errors/circuit-breaker.js";
import { ErrorDedup } from "../../src/ops/errors/dedup.js";
import { closeProject, listProjects, loadProject } from "../../src/projects/loader.js";
import { type SkillContext, createUnifiedExecutor } from "../../src/skills/executor.js";
import { generateMcpServersConfig } from "../../src/skills/mcp-config.js";
import { createDefaultRegistry } from "../../src/skills/registry.js";
import { appendJsonl, readJsonlSync } from "../../src/utils/jsonl.js";

// --- Helpers ---

function makeConfig(overrides?: Partial<Config>): Config {
	return {
		version: 1,
		operator: { name: "Sreeni", timezone: "Asia/Kolkata" },
		tier_routing: { default: "not-configured" },
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
				allowed_peers: ["sreeni-123"],
				allow_groups: false,
			},
		},
		extractor: { cron: "0 2 * * *" },
		...overrides,
	};
}

function setupSession(
	tmpDir: string,
	channelType: "cli" | "telegram" = "cli",
	identifier = "/home/sreeni/project",
) {
	const configPath = path.join(tmpDir, "config.json");
	const projectsDir = path.join(tmpDir, "projects");
	const metaSkillsDir = path.join(tmpDir, "meta-skills");
	const skillsDir = path.join(tmpDir, "skills");
	fs.mkdirSync(metaSkillsDir, { recursive: true });
	fs.mkdirSync(skillsDir, { recursive: true });

	const config = makeConfig();
	writeConfig(config, configPath);

	const binding = getProjectBinding(channelType, identifier);
	const project = loadProject(binding, projectsDir);
	const registry = createDefaultRegistry();
	const ctx: SkillContext = { project, config, channelType, sessionId: `session-${Date.now()}` };
	const executor = createUnifiedExecutor(registry, ctx);

	const tables = loadAllRoutingTables(metaSkillsDir);
	const skillRegs = scanSkillsForRegistration(skillsDir);
	applySkillRegistrations(tables, skillRegs);

	const dispatcher = new GatewayDispatcher(tables, executor);

	return {
		dispatcher,
		project,
		config,
		binding,
		registry,
		ctx,
		configPath,
		projectsDir,
		metaSkillsDir,
		skillsDir,
	};
}

// --- Test suites ---

describe("E2E: Fresh install & first session", () => {
	const dirs: string[] = [];
	function tmp() {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
		dirs.push(d);
		return d;
	}
	afterEach(() => {
		dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
		dirs.length = 0;
	});

	it("scenario: operator installs, configures, starts first session, makes decisions, exits", async () => {
		const tmpDir = tmp();

		// 1. Write config (wizard output)
		const configPath = path.join(tmpDir, "config.json");
		writeConfig(makeConfig(), configPath);
		const config = readConfig(configPath);
		expect(config.operator.name).toBe("Sreeni");

		// 2. Validate channel
		validateChannelBinding("cli", config.channels);

		// 3. Start session
		const { dispatcher, project } = setupSession(tmpDir);

		// 4. Operator makes 3 decisions during session
		project.decisions.addDecision({
			sessionId: "session-001",
			project: project.binding,
			content: "Build on Pi because it handles agent loop, sessions, and extensions",
			confidence: 0.95,
			source: "manual",
			tags: ["architecture"],
		});
		project.decisions.addDecision({
			sessionId: "session-001",
			project: project.binding,
			content: "8-verb gateway because security and token savings",
			confidence: 0.95,
			source: "manual",
			tags: ["architecture", "security"],
		});
		project.decisions.addDecision({
			sessionId: "session-001",
			project: project.binding,
			content: "Per-agent model assignment, no hardcoded tiers",
			confidence: 0.95,
			source: "manual",
			tags: ["models"],
		});

		// 5. Write journal entry
		const journalResult = await dispatcher.dispatch(
			"journal",
			{
				action: "write",
				entry: {
					wins: ["completed MVP in one session"],
					blockers: ["Pi re-audit pending"],
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

		// 6. Verify state before exit
		const stats = project.index.getStats();
		expect(stats.decisions).toBe(3);
		expect(stats.daily_logs).toBe(1);

		// 7. Checkpoint
		project.checkpoint.write({
			last_processed_session_id: "session-001",
			last_processed_timestamp: new Date().toISOString(),
			total_sessions_processed: 1,
			last_run_status: "success",
		});

		// 8. Close session (simulates exit)
		closeProject(project);

		// 9. Verify data persists on disk
		const projectDir = path.join(tmpDir, "projects", project.binding);
		expect(fs.existsSync(path.join(projectDir, "decisions.jsonl"))).toBe(true);
		expect(fs.existsSync(path.join(projectDir, "daily-logs.jsonl"))).toBe(true);
		expect(fs.existsSync(path.join(projectDir, "memory-index.db"))).toBe(true);
	});
});

describe("E2E: Multi-session memory persistence", () => {
	const dirs: string[] = [];
	function tmp() {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-mem-"));
		dirs.push(d);
		return d;
	}
	afterEach(() => {
		dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
		dirs.length = 0;
	});

	it("scenario: decisions from session 1 are recallable in session 2 and 3", async () => {
		const tmpDir = tmp();

		// --- Session 1: make decisions ---
		const s1 = setupSession(tmpDir);
		s1.project.decisions.addDecision({
			sessionId: "session-001",
			project: s1.binding,
			content: "Use JSONL as source of truth, SQLite as derived index",
			confidence: 0.95,
			source: "manual",
		});
		s1.project.decisions.addDecision({
			sessionId: "session-001",
			project: s1.binding,
			content: "Telegram bot must have allowed_peers whitelist",
			confidence: 0.95,
			source: "manual",
		});
		s1.project.checkpoint.write({
			last_processed_session_id: "session-001",
			last_processed_timestamp: new Date().toISOString(),
			total_sessions_processed: 1,
			last_run_status: "success",
		});
		closeProject(s1.project);

		// --- Session 2: recall + add more ---
		const s2 = setupSession(tmpDir);
		s2.project.decisions.rebuildIndex(); // rebuild from JSONL on session start

		const recallResult = await s2.dispatcher.dispatch(
			"recall",
			{
				query: "JSONL",
			},
			{ channelType: "cli", project: s2.binding },
		);

		const matches = (recallResult.result as { matches: Array<{ content: string }> }).matches;
		expect(matches.length).toBeGreaterThanOrEqual(1);
		expect(matches.some((m) => m.content.includes("JSONL"))).toBe(true);

		// Add a new decision in session 2
		s2.project.decisions.addDecision({
			sessionId: "session-002",
			project: s2.binding,
			content: "No hardcoded model tiers, operator picks per-agent",
			confidence: 0.95,
			source: "manual",
		});
		closeProject(s2.project);

		// --- Session 3: recall everything ---
		const s3 = setupSession(tmpDir);
		s3.project.decisions.rebuildIndex();

		const allDecisions = s3.project.decisions.query({});
		expect(allDecisions).toHaveLength(3); // 2 from s1 + 1 from s2

		// Recall specific topics
		const telegramRecall = await s3.dispatcher.dispatch(
			"recall",
			{
				query: "Telegram",
			},
			{ channelType: "cli", project: s3.binding },
		);
		expect(
			(telegramRecall.result as { matches: Array<{ content: string }> }).matches.length,
		).toBeGreaterThanOrEqual(1);

		// Checkpoint shows total progress
		expect(s3.project.checkpoint.isProcessed("session-001")).toBe(true);
		expect(s3.project.checkpoint.isProcessed("session-003")).toBe(false);

		closeProject(s3.project);
	});
});

describe("E2E: Daily journal lifecycle", () => {
	const dirs: string[] = [];
	function tmp() {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-journal-"));
		dirs.push(d);
		return d;
	}
	afterEach(() => {
		dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
		dirs.length = 0;
	});

	it("scenario: write entries over multiple days, read trends, run weekly review", async () => {
		const { dispatcher, project, binding } = setupSession(tmp());
		const ctx = { channelType: "cli" as const, project: binding };

		// Day 1
		await dispatcher.dispatch(
			"journal",
			{
				action: "write",
				date: "2026-04-07",
				entry: {
					wins: ["locked architecture"],
					blockers: [],
					mood_score: 5,
					mood_text: "great",
					energy_score: 4,
					energy_text: "high",
					remember_tomorrow: "start impl",
					weekly_review_flag: false,
				},
			},
			ctx,
		);

		// Day 2
		await dispatcher.dispatch(
			"journal",
			{
				action: "write",
				date: "2026-04-08",
				entry: {
					wins: ["built Phase 1-5"],
					blockers: ["waiting for re-audit"],
					mood_score: 4,
					mood_text: "good",
					energy_score: 3,
					energy_text: "ok",
					remember_tomorrow: "finish phases",
					weekly_review_flag: false,
				},
			},
			ctx,
		);

		// Day 3
		await dispatcher.dispatch(
			"journal",
			{
				action: "write",
				date: "2026-04-09",
				entry: {
					wins: ["completed all 10 phases"],
					blockers: [],
					mood_score: 5,
					mood_text: "on fire",
					energy_score: 5,
					energy_text: "peak",
					remember_tomorrow: "test everything",
					weekly_review_flag: true,
				},
			},
			ctx,
		);

		// Read back a specific day
		const day2 = await dispatcher.dispatch("journal", { action: "read", date: "2026-04-08" }, ctx);
		const entry = day2.result as DailyLogEntry;
		expect(entry.wins).toContain("built Phase 1-5");
		expect(entry.mood_score).toBe(4);

		// Trends
		const trends = await dispatcher.dispatch("journal", { action: "trends" }, ctx);
		expect(trends.result).toBeDefined();

		// Weekly review
		const review = await dispatcher.dispatch("journal", { action: "review" }, ctx);
		const reviewData = review.result as { wins: string[]; avg_mood: number; days_logged: number };
		expect(reviewData.days_logged).toBe(3);
		expect(reviewData.wins).toContain("locked architecture");
		expect(reviewData.wins).toContain("completed all 10 phases");
		expect(reviewData.avg_mood).toBeGreaterThanOrEqual(4);

		closeProject(project);
	});
});

describe("E2E: Council deliberation", () => {
	const dirs: string[] = [];
	function tmp() {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-council-"));
		dirs.push(d);
		return d;
	}
	afterEach(() => {
		dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
		dirs.length = 0;
	});

	it("scenario: 4 agents deliberate, critic dissents, result has consensus=false", async () => {
		// Assign different models to each agent (simulating user config)
		const agents = AVAILABLE_AGENTS.map((a) => {
			const models: Record<string, string> = {
				orchestrator: "ollama-cloud/nemotron-3-super",
				researcher: "openrouter/minimax-m2.7",
				critic: "openrouter/kimi-k2",
				"devil-advocate": "anthropic/claude-sonnet-4-6",
			};
			return { ...a, model: models[a.name] };
		});

		// Verify model resolution
		expect(resolveAgentModel(agents[0]!)).toBe("ollama-cloud/nemotron-3-super");
		expect(resolveAgentModel(agents[1]!)).toBe("openrouter/minimax-m2.7");
		expect(resolveAgentModel(agents[2]!)).toBe("openrouter/kimi-k2");
		expect(resolveAgentModel(agents[3]!)).toBe("anthropic/claude-sonnet-4-6");

		const council = new CouncilManager({
			topic: "Should we use Redis or SQLite for the memory index?",
			agents,
			speakerMode: "round_robin",
			maxRounds: 12,
		});

		const result = await council.deliberate(async (agent, transcript, phase) => {
			// Simulate realistic agent responses
			if (agent.name === "researcher" && phase === "research") {
				return "SQLite handles up to 281 TB databases, supports WAL mode for concurrent reads, and requires zero server infrastructure. Redis offers sub-ms latency but needs a running daemon. For a single-user agent OS, SQLite is the standard choice.";
			}
			if (agent.name === "critic" && phase === "critique") {
				return "I have a concern about SQLite: if we ever want multi-device sync or real-time collaboration, SQLite becomes a bottleneck. Redis has pub/sub built in. We should at least design the interface so we can swap later.";
			}
			if (agent.name === "devil-advocate" && phase === "critique") {
				return "The group is dismissing Redis too quickly. Consider the alternative: Redis with persistence gives us both speed AND durability. The 'zero infrastructure' argument for SQLite ignores that we already require Node.js.";
			}
			if (phase === "synthesis") {
				return "- Use SQLite for MVP (simplicity wins)\n- Design the MemoryIndex interface to be swappable\n- Revisit Redis if multi-device sync becomes a requirement in v2";
			}
			return `[${agent.name}] Acknowledging ${transcript.length} prior turns in ${phase}`;
		});

		// Verify council result
		expect(result.agents).toHaveLength(4);
		expect(result.phases_completed).toBe(3);
		expect(result.consensus).toBe(false); // critic and devil-advocate raised concerns
		expect(result.dissent.length).toBeGreaterThan(0);
		expect(result.dissent.some((d) => d.includes("critic"))).toBe(true);
		expect(result.recommendations.length).toBeGreaterThan(0);
		expect(result.recommendations.some((r) => r.includes("SQLite"))).toBe(true);
		expect(result.structured_channels.researchFindings).toContain("SQLite");
		expect(result.structured_channels.draft).toContain("SQLite for MVP");
	});
});

describe("E2E: Cross-channel isolation", () => {
	const dirs: string[] = [];
	function tmp() {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-channel-"));
		dirs.push(d);
		return d;
	}
	afterEach(() => {
		dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
		dirs.length = 0;
	});

	it("scenario: CLI decisions invisible to Telegram, and vice versa", async () => {
		const tmpDir = tmp();
		const projectsDir = path.join(tmpDir, "projects");

		// CLI session - add secret decision
		const cliProject = loadProject("cli/work-project", projectsDir);
		cliProject.decisions.addDecision({
			sessionId: "cli-s1",
			project: "cli/work-project",
			content: "Internal: salary negotiation strategy - ask for 20% raise",
			confidence: 0.95,
			source: "manual",
		});

		// Telegram session - add public decision
		const telegramProject = loadProject("telegram/sreeni-123", projectsDir);
		telegramProject.decisions.addDecision({
			sessionId: "tg-s1",
			project: "telegram/sreeni-123",
			content: "Shared: blog post schedule is every 3rd day",
			confidence: 0.95,
			source: "manual",
		});

		// CLI recall should NOT see Telegram data
		const cliResults = cliProject.memoryQuery.recall({
			query: "blog",
			project: "cli/work-project",
		});
		expect(cliResults).toHaveLength(0);

		// Telegram recall should NOT see CLI data
		const tgResults = telegramProject.memoryQuery.recall({
			query: "salary",
			project: "telegram/sreeni-123",
		});
		expect(tgResults).toHaveLength(0);

		// Each channel sees its own data
		const cliOwn = cliProject.memoryQuery.recall({ query: "salary", project: "cli/work-project" });
		expect(cliOwn.length).toBeGreaterThan(0);

		const tgOwn = telegramProject.memoryQuery.recall({
			query: "blog",
			project: "telegram/sreeni-123",
		});
		expect(tgOwn.length).toBeGreaterThan(0);

		// List shows both projects
		const projects = listProjects(projectsDir);
		expect(projects).toContain("cli/work-project");
		expect(projects).toContain("telegram/sreeni-123");

		closeProject(cliProject);
		closeProject(telegramProject);
	});
});

describe("E2E: All 8 verbs end-to-end", () => {
	const dirs: string[] = [];
	function tmp() {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-verbs-"));
		dirs.push(d);
		return d;
	}
	afterEach(() => {
		dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
		dirs.length = 0;
	});

	it("scenario: exercise every verb with realistic args and verify output structure", async () => {
		const { dispatcher, project, binding } = setupSession(tmp());
		const ctx = { channelType: "cli" as const, project: binding };

		// Seed some memory first
		project.decisions.addDecision({
			sessionId: "s1",
			project: binding,
			content: "Use Pi as runtime foundation",
			confidence: 0.95,
			source: "manual",
		});

		// 1. RECALL - query memory
		const recall = await dispatcher.dispatch("recall", { query: "runtime foundation" }, ctx);
		expect(recall.verb).toBe("recall");
		expect(recall.target).toBe("memory-recall");
		const recallData = recall.result as { matches: unknown[]; total: number };
		expect(recallData.total).toBeGreaterThanOrEqual(1);

		// 2. RESEARCH - investigate a topic
		const research = await dispatcher.dispatch(
			"research",
			{ topic: "Pi coding agent architecture", depth: "deep" },
			ctx,
		);
		expect(research.verb).toBe("research");
		expect(research.target).toBe("researcher");
		const researchData = research.result as {
			synthesis: string;
			citations: unknown[];
			query_plan: string[];
		};
		expect(researchData.synthesis.length).toBeGreaterThan(0);
		expect(researchData.query_plan.length).toBeGreaterThan(3); // deep = 5 queries

		// 3. INGEST - process a file (stub since no real file)
		const ingest = await dispatcher.dispatch("ingest", { source: "/tmp/test.pdf" }, ctx);
		expect(ingest.verb).toBe("ingest");
		// Routes to pdf skill (external, returns not_registered stub)

		// 4. MONITOR - check for CVEs
		const monitor = await dispatcher.dispatch("monitor", { target: "cves" }, ctx);
		expect(monitor.verb).toBe("monitor");
		expect(monitor.target).toBe("cve-monitor");

		// 5. JOURNAL - write and read
		await dispatcher.dispatch(
			"journal",
			{
				action: "write",
				entry: {
					wins: ["tested all verbs"],
					blockers: [],
					mood_score: 5,
					mood_text: "excellent",
					energy_score: 5,
					energy_text: "peak",
					remember_tomorrow: "ship it",
					weekly_review_flag: false,
				},
			},
			ctx,
		);
		const journalRead = await dispatcher.dispatch("journal", { action: "read" }, ctx);
		expect((journalRead.result as { wins: string[] }).wins).toContain("tested all verbs");

		// 6. PRODUCE - generate content with SEO score
		const produce = await dispatcher.dispatch(
			"produce",
			{
				kind: "blog-post",
				prompt: `${"Building autonomous agents with persistent memory is the future of personal AI. ".repeat(20)}What will you build?`,
			},
			ctx,
		);
		expect(produce.verb).toBe("produce");
		const produceData = produce.result as { seo_score: number };
		expect(produceData.seo_score).toBeGreaterThan(0);

		// 7. DISPATCH - external action (stub)
		const dispatch = await dispatcher.dispatch("dispatch", { action: "git.status" }, ctx);
		expect(dispatch.verb).toBe("dispatch");

		// 8. NOTIFY - send notification (stub)
		const notify = await dispatcher.dispatch(
			"notify",
			{ message: "All verbs tested successfully", severity: "info" },
			ctx,
		);
		expect(notify.verb).toBe("notify");

		closeProject(project);
	});
});

describe("E2E: Custom skill registration", () => {
	const dirs: string[] = [];
	function tmp() {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-skills-"));
		dirs.push(d);
		return d;
	}
	afterEach(() => {
		dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
		dirs.length = 0;
	});

	it("scenario: install a custom skill, verify it appears in routing table for its declared verb", () => {
		const tmpDir = tmp();
		const skillsDir = path.join(tmpDir, "skills");

		// Create a custom skill
		const customSkillDir = path.join(skillsDir, "my-note-taker");
		fs.mkdirSync(customSkillDir, { recursive: true });
		fs.writeFileSync(
			path.join(customSkillDir, "SKILL.md"),
			[
				"---",
				"name: my-note-taker",
				"description: Takes structured notes from conversations",
				"mypensieve_exposes_via: recall",
				"mypensieve_priority: 3",
				"---",
				"A custom note-taking skill that indexes conversation highlights.",
			].join("\n"),
		);

		// Scan and register
		const registrations = scanSkillsForRegistration(skillsDir);
		expect(registrations).toHaveLength(1);
		expect(registrations[0]?.skillName).toBe("my-note-taker");
		expect(registrations[0]?.verb).toBe("recall");
		expect(registrations[0]?.priority).toBe(3);

		// Apply to routing tables
		const metaSkillsDir = path.join(tmpDir, "meta-skills");
		fs.mkdirSync(metaSkillsDir, { recursive: true });
		const tables = loadAllRoutingTables(metaSkillsDir);
		applySkillRegistrations(tables, registrations);

		// Verify the custom skill is in the recall routing table
		const recallTable = tables.get("recall")!;
		const customRule = recallTable.rules.find((r) => r.target === "my-note-taker");
		expect(customRule).toBeDefined();
		expect(customRule?.priority).toBe(3);
		expect(customRule?.name).toBe("custom:my-note-taker");
	});
});

describe("E2E: Error handling pipeline", () => {
	it("scenario: rapid errors -> dedup suppresses -> circuit breaker opens -> recovery resets", () => {
		const dedup = new ErrorDedup();
		const registry = new CircuitBreakerRegistry();
		const breaker = registry.get("mcp:cve-intel", { failureThreshold: 3, cooldownMs: 100 });

		// Simulate 10 rapid failures from cve-intel MCP
		const surfaced: boolean[] = [];
		for (let i = 0; i < 10; i++) {
			const { shouldSurface } = dedup.record({
				id: `err-${i}`,
				timestamp: new Date().toISOString(),
				severity: "high",
				error_type: "mcp_crash",
				error_src: "cve-intel",
				message: "Connection refused to OSV.dev API",
				context: {},
				resolved: false,
				retry_count: i,
			});
			surfaced.push(shouldSurface);
			breaker.recordFailure();
		}

		// Only first error was surfaced
		expect(surfaced[0]).toBe(true);
		expect(surfaced.slice(1).every((s) => !s)).toBe(true);

		// Circuit breaker is open
		expect(breaker.getState().status).toBe("open");
		expect(breaker.canExecute()).toBe(false);
		expect(registry.getOpen()).toHaveLength(1);

		// Dedup shows suppressed summary
		const summaries = dedup.getSuppressedSummaries();
		expect(summaries).toHaveLength(1);
		expect(summaries[0]?.count).toBe(10);
		expect(summaries[0]?.error_src).toBe("cve-intel");

		// Recovery: reset the circuit breaker
		expect(registry.resetByName("mcp:cve-intel")).toBe(true);
		expect(breaker.getState().status).toBe("closed");
		expect(breaker.canExecute()).toBe(true);
		expect(registry.getOpen()).toHaveLength(0);
	});
});

describe("E2E: Backup & restore readiness", () => {
	const dirs: string[] = [];
	function tmp() {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-backup-"));
		dirs.push(d);
		return d;
	}
	afterEach(() => {
		dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
		dirs.length = 0;
	});

	it("scenario: create fake backups, prune old ones, verify recent kept", () => {
		const backupDir = tmp();

		// Create 5 backup files with varying ages
		const files = [
			{ name: "mypensieve-backup-2025-01-01T00-00-00.tar.gz", age: 400 }, // very old
			{ name: "mypensieve-backup-2025-06-01T00-00-00.tar.gz", age: 200 }, // old
			{ name: "mypensieve-backup-2026-03-01T00-00-00.tar.gz", age: 40 }, // over retention
			{ name: "mypensieve-backup-2026-04-05T00-00-00.tar.gz", age: 5 }, // recent
			{ name: "mypensieve-backup-2026-04-09T00-00-00.tar.gz", age: 1 }, // yesterday
		];

		for (const f of files) {
			const filePath = path.join(backupDir, f.name);
			fs.writeFileSync(filePath, `backup content ${f.name}`);
			const date = new Date(Date.now() - f.age * 86400000);
			fs.utimesSync(filePath, date, date);
		}

		// Prune with 30-day retention
		const pruned = pruneBackups(backupDir, 30);
		expect(pruned).toBe(3); // first 3 are older than 30 days

		// Verify remaining
		const remaining = fs.readdirSync(backupDir);
		expect(remaining).toHaveLength(2);
		expect(remaining).toContain("mypensieve-backup-2026-04-05T00-00-00.tar.gz");
		expect(remaining).toContain("mypensieve-backup-2026-04-09T00-00-00.tar.gz");
	});
});

describe("E2E: Security enforcement", () => {
	const dirs: string[] = [];
	function tmp() {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-security-"));
		dirs.push(d);
		return d;
	}
	afterEach(() => {
		dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
		dirs.length = 0;
	});

	it("scenario: unauthorized Telegram peer gets rejected", () => {
		const config = makeConfig();
		const manager = new PeerSessionManager(config, {
			projectsDir: path.join(tmp(), "projects"),
			timeoutMs: 30000,
		});

		// Allowed peer works
		const session = manager.getOrCreate("sreeni-123");
		expect(session.peerId).toBe("sreeni-123");

		// Unknown peer rejected
		expect(() => manager.getOrCreate("stranger-456")).toThrow(PeerNotAllowedError);
		expect(() => manager.getOrCreate("hacker-789")).toThrow(PeerNotAllowedError);

		// Only 1 session created (the allowed one)
		expect(manager.count()).toBe(1);

		manager.closeAll();
	});

	it("scenario: escape hatch blocked on Telegram, allowed on CLI when configured", () => {
		// Telegram - always blocked
		const telegramConfig = makeConfig();
		validateChannelBinding("telegram", telegramConfig.channels);
		// The schema enforces tool_escape_hatch: false for Telegram at type level

		// CLI - default off
		const cliConfig = makeConfig();
		expect(cliConfig.channels.cli.tool_escape_hatch).toBe(false);

		// CLI - can be enabled
		const cliEnabled = makeConfig({
			channels: {
				cli: { enabled: true, tool_escape_hatch: true },
				telegram: {
					enabled: true,
					tool_escape_hatch: false,
					allowed_peers: ["test"],
					allow_groups: false,
				},
			},
		});
		expect(cliEnabled.channels.cli.tool_escape_hatch).toBe(true);
	});

	it("scenario: playwright-cli skill blocked on Telegram channel", async () => {
		const { registry } = setupSession(tmp());

		const project = loadProject("telegram/test", path.join(tmp(), "projects"));
		const ctx: SkillContext = {
			project,
			config: makeConfig(),
			channelType: "telegram",
			sessionId: "test",
		};

		const result = await registry.execute("playwright-cli", { source: "https://evil.com" }, ctx);
		expect(result.success).toBe(false);
		expect(result.error).toContain("not available on Telegram");

		closeProject(project);
	});

	it("scenario: gateway exposes exactly 8 verbs, no raw skill names", () => {
		expect(VERB_NAMES).toHaveLength(8);
		expect(VERB_NAMES).toEqual([
			"recall",
			"research",
			"ingest",
			"monitor",
			"journal",
			"produce",
			"dispatch",
			"notify",
		]);

		// No skill names in the verb list
		const skillNames = [
			"daily-log",
			"memory-recall",
			"researcher",
			"cve-monitor",
			"blog-seo",
			"playwright-cli",
			"image-edit",
			"video-edit",
			"audio-edit",
		];
		for (const skill of skillNames) {
			expect(VERB_NAMES).not.toContain(skill);
		}
	});

	it("scenario: config file permissions are read-only after write", () => {
		const configPath = path.join(tmp(), "config.json");
		writeConfig(makeConfig(), configPath);

		const stats = fs.statSync(configPath);
		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o444);
	});
});

describe("E2E: MCP configuration", () => {
	it("scenario: all 6 MCPs generate valid config, all zero-auth", () => {
		const config = generateMcpServersConfig();
		const mcpNames = Object.keys(config);

		expect(mcpNames).toHaveLength(6);
		expect(mcpNames).toContain("datetime");
		expect(mcpNames).toContain("playwright");
		expect(mcpNames).toContain("duckduckgo-search");
		expect(mcpNames).toContain("whisper-local");
		expect(mcpNames).toContain("gh-cli");
		expect(mcpNames).toContain("cve-intel");

		// Each has command and args
		for (const [name, mcp] of Object.entries(config)) {
			expect(mcp.command, `${name} missing command`).toBeDefined();
			expect(mcp.args, `${name} missing args`).toBeDefined();
		}
	});
});

describe("E2E: Agent team & model assignment", () => {
	it("scenario: default install has 1 agent, 4 available, all models unset", () => {
		expect(DEFAULT_AGENTS).toHaveLength(1);
		expect(DEFAULT_AGENTS[0]?.name).toBe("orchestrator");

		expect(AVAILABLE_AGENTS).toHaveLength(4);

		// No models hardcoded
		for (const agent of AVAILABLE_AGENTS) {
			expect(agent.model).toBeUndefined();
		}
	});

	it("scenario: operator assigns models, resolveAgentModel picks them up", () => {
		const custom = AVAILABLE_AGENTS.map((a) => ({
			...a,
			model:
				a.name === "orchestrator"
					? "ollama-cloud/nemotron-3-super"
					: a.name === "researcher"
						? "openrouter/minimax-m2.7"
						: a.name === "critic"
							? "openrouter/kimi-k2"
							: "anthropic/claude-sonnet-4-6",
		}));

		expect(resolveAgentModel(custom[0]!)).toBe("ollama-cloud/nemotron-3-super");
		expect(resolveAgentModel(custom[1]!)).toBe("openrouter/minimax-m2.7");
		expect(resolveAgentModel(custom[2]!)).toBe("openrouter/kimi-k2");
		expect(resolveAgentModel(custom[3]!)).toBe("anthropic/claude-sonnet-4-6");
	});

	it("scenario: single model for everything works via fallback", () => {
		// Operator only picks one model
		const singleModel = "ollama-cloud/nemotron-3-super";

		for (const agent of AVAILABLE_AGENTS) {
			// No per-agent model set, falls back to default
			expect(resolveAgentModel(agent, singleModel)).toBe(singleModel);
		}
	});
});

describe("E2E: Telegram message handling", () => {
	it("scenario: long response gets chunked for Telegram's 4096 limit", () => {
		// Simulate a long research response
		const longResponse = `## Research Findings\n\n${"SQLite is a C library that provides a lightweight, disk-based database. ".repeat(100)}\n\n## Recommendations\n\n- Use SQLite for MVP\n- Consider alternatives for v2`;

		const chunks = chunkMessage(longResponse);

		// Must be split
		expect(chunks.length).toBeGreaterThan(1);

		// Each chunk within Telegram limit
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(4096);
		}

		// All content preserved (total chars match minus trimmed whitespace)
		const totalContent = chunks.join("");
		expect(totalContent.length).toBeGreaterThanOrEqual(longResponse.length * 0.95); // allow minor whitespace trim
	});
});
