import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/**
 * Cross-phase integration test: Phase 1+2+3+4
 *
 * Validates the full session lifecycle:
 *   Config -> Channel binding -> Project loader -> Memory layers
 *   -> Gateway dispatcher -> Recall verb -> Memory results
 *
 * Simulates what happens when an operator runs `mypensieve start`,
 * makes decisions, exits, and starts a new session to recall them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { readConfig } from "../../src/config/reader.js";
import type { Config } from "../../src/config/schema.js";
import { writeConfig } from "../../src/config/writer.js";
import { getProjectBinding } from "../../src/core/session.js";
import { validateChannelBinding } from "../../src/gateway/binding-validator.js";
import { GatewayDispatcher, type SkillExecutor } from "../../src/gateway/dispatcher.js";
import { loadAllRoutingTables } from "../../src/gateway/routing-loader.js";
import { closeProject, loadProject } from "../../src/projects/loader.js";

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
			destinations: [{ type: "local", path: "/tmp" }],
			include_secrets: false,
		},
		channels: {
			cli: { enabled: true, tool_escape_hatch: false },
			telegram: { enabled: false, tool_escape_hatch: false },
		},
		extractor: { cron: "0 2 * * *" },
	};
}

describe("Phase 1+2+3+4: Full session lifecycle simulation", () => {
	const tmpDirs: string[] = [];

	function makeTmpDir(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phase1234-"));
		tmpDirs.push(dir);
		return dir;
	}

	afterEach(() => {
		for (const dir of tmpDirs) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		tmpDirs.length = 0;
	});

	it("Session 1: make decisions. Session 2: recall them via gateway.", async () => {
		const tmpDir = makeTmpDir();
		const configPath = path.join(tmpDir, "config.json");
		const projectsDir = path.join(tmpDir, "projects");
		const metaSkillsDir = path.join(tmpDir, "meta-skills");
		fs.mkdirSync(metaSkillsDir, { recursive: true });

		// --- Setup ---
		writeConfig(validConfig(), configPath);
		const config = readConfig(configPath);
		validateChannelBinding("cli", config.channels);
		const binding = getProjectBinding("cli", "/home/sreeni/myproject");

		// --- Session 1: Make decisions ---
		const session1 = loadProject(binding, projectsDir);

		session1.decisions.addDecision({
			sessionId: "session-001",
			project: binding,
			content: "Use Pi as the runtime foundation because it handles 70% of what we need",
			confidence: 0.95,
			source: "manual",
			tags: ["architecture"],
		});

		session1.decisions.addDecision({
			sessionId: "session-001",
			project: binding,
			content: "Ship CLI and Telegram in MVP, defer Discord to v1.5",
			confidence: 0.95,
			source: "manual",
			tags: ["scope"],
		});

		session1.threads.createThread({
			project: binding,
			title: "OAuth refresh handling",
			firstMessage: {
				timestamp: new Date().toISOString(),
				session_id: "session-001",
				role: "operator",
				content: "Need to decide on OAuth refresh strategy after Pi re-audit",
			},
		});

		session1.checkpoint.write({
			last_processed_session_id: "session-001",
			last_processed_timestamp: new Date().toISOString(),
			total_sessions_processed: 1,
			last_run_status: "success",
		});

		// Close session 1 (simulates `mypensieve` exit)
		closeProject(session1);

		// --- Session 2: Recall via gateway ---
		const session2 = loadProject(binding, projectsDir);

		// Rebuild index from JSONL (simulates what happens on session start)
		session2.decisions.rebuildIndex();
		session2.threads.rebuildIndex();

		// Set up gateway with memory executor
		const tables = loadAllRoutingTables(metaSkillsDir);
		const executor: SkillExecutor = async (target, _type, args) => {
			if (target === "memory-recall") {
				return session2.memoryQuery.recall({
					query: args.query as string,
				});
			}
			return { status: "not_implemented", target };
		};
		const dispatcher = new GatewayDispatcher(tables, executor);

		// Recall: "What did we decide about the runtime?"
		const runtimeResult = await dispatcher.dispatch(
			"recall",
			{ query: "runtime" },
			{ channelType: "cli", project: binding },
		);
		const runtimeMatches = runtimeResult.result as Array<{ content: string }>;
		expect(
			runtimeMatches.some(
				(m) => m.content.includes("runtime foundation") || m.content.includes("Pi"),
			),
		).toBe(true);

		// Recall: "What's the MVP scope?"
		const scopeResult = await dispatcher.dispatch(
			"recall",
			{ query: "MVP" },
			{ channelType: "cli", project: binding },
		);
		const scopeMatches = scopeResult.result as Array<{ content: string }>;
		expect(
			scopeMatches.some((m) => m.content.includes("MVP") || m.content.includes("Telegram")),
		).toBe(true);

		// Recall: "Any open threads about OAuth?"
		const oauthResult = await dispatcher.dispatch(
			"recall",
			{ query: "OAuth" },
			{ channelType: "cli", project: binding },
		);
		const oauthMatches = oauthResult.result as Array<{ layer: string; content: string }>;
		expect(oauthMatches.some((m) => m.layer === "threads")).toBe(true);

		// Verify checkpoint survived across sessions
		expect(session2.checkpoint.isProcessed("session-001")).toBe(true);
		expect(session2.checkpoint.isProcessed("session-002")).toBe(false);

		closeProject(session2);
	});

	it("multiple projects in parallel don't leak memory", async () => {
		const tmpDir = makeTmpDir();
		const projectsDir = path.join(tmpDir, "projects");

		const projectA = loadProject("cli/project-a", projectsDir);
		const projectB = loadProject("cli/project-b", projectsDir);

		// Add decisions to each project
		projectA.decisions.addDecision({
			sessionId: "s1",
			project: "cli/project-a",
			content: "Project A secret decision",
			confidence: 0.95,
			source: "manual",
		});
		projectB.decisions.addDecision({
			sessionId: "s1",
			project: "cli/project-b",
			content: "Project B public decision",
			confidence: 0.95,
			source: "manual",
		});

		// Query from project A should not see project B's decisions
		const aResults = projectA.memoryQuery.recall({ query: "decision", project: "cli/project-a" });
		expect(aResults.every((m) => !m.content.includes("Project B"))).toBe(true);

		// And vice versa
		const bResults = projectB.memoryQuery.recall({ query: "decision", project: "cli/project-b" });
		expect(bResults.every((m) => !m.content.includes("Project A"))).toBe(true);

		closeProject(projectA);
		closeProject(projectB);
	});

	it("config -> project -> stats shows accurate counts", () => {
		const tmpDir = makeTmpDir();
		const projectsDir = path.join(tmpDir, "projects");
		const project = loadProject("cli/stats-test", projectsDir);

		// Add various items
		for (let i = 0; i < 5; i++) {
			project.decisions.addDecision({
				sessionId: "s1",
				project: "test",
				content: `decision ${i}`,
				confidence: 0.8,
				source: "auto",
			});
		}
		project.threads.createThread({
			project: "test",
			title: "Open thread",
			firstMessage: {
				timestamp: new Date().toISOString(),
				session_id: "s1",
				role: "operator",
				content: "msg",
			},
		});
		project.persona.addDelta({
			sessionId: "s1",
			field: "style",
			deltaType: "add",
			content: "terse",
			confidence: 0.7,
		});

		const stats = project.index.getStats();
		expect(stats.decisions).toBe(5);
		expect(stats.threads).toBe(1);
		expect(stats.open_threads).toBe(1);
		expect(stats.persona_deltas).toBe(1);
		expect(stats.pending_deltas).toBe(1);

		closeProject(project);
	});
});
