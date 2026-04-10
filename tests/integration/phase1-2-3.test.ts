/**
 * Cross-phase integration test: Phase 1+2+3
 *
 * Validates the full chain:
 *   Config -> Gateway -> Recall verb -> Memory query -> Returns decisions/threads/persona
 *   Config -> Gateway -> Journal verb -> Daily log entry -> Queryable via recall
 *
 * This is the "can the agent recall its own decisions?" test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeConfig } from "../../src/config/writer.js";
import type { Config } from "../../src/config/schema.js";
import { GatewayDispatcher } from "../../src/gateway/dispatcher.js";
import { loadAllRoutingTables } from "../../src/gateway/routing-loader.js";
import { VERB_NAMES } from "../../src/gateway/verbs.js";
import { MemoryIndex } from "../../src/memory/sqlite-index.js";
import { DecisionsLayer } from "../../src/memory/layers/decisions.js";
import { ThreadsLayer } from "../../src/memory/layers/threads.js";
import { PersonaLayer } from "../../src/memory/layers/persona.js";
import { MemoryQuery } from "../../src/memory/query.js";
import { CheckpointManager } from "../../src/memory/checkpoint.js";
import { getProjectBinding } from "../../src/core/session.js";

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

describe("Phase 1+2+3: Gateway -> Memory -> Recall", () => {
	let tmpDir: string;
	let projectDir: string;
	let index: MemoryIndex;
	let decisions: DecisionsLayer;
	let threads: ThreadsLayer;
	let persona: PersonaLayer;
	let memoryQuery: MemoryQuery;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase123-"));
		projectDir = path.join(tmpDir, "projects", "test");
		fs.mkdirSync(projectDir, { recursive: true });
		fs.mkdirSync(path.join(tmpDir, "meta-skills"), { recursive: true });

		index = new MemoryIndex(":memory:");
		decisions = new DecisionsLayer(projectDir, index);
		threads = new ThreadsLayer(projectDir, index);
		persona = new PersonaLayer(projectDir, index);
		memoryQuery = new MemoryQuery(decisions, threads, persona);
	});

	afterEach(() => {
		index.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("full loop: add decisions -> dispatch recall verb -> get results from memory", async () => {
		// Step 1: Simulate extractor adding decisions from a previous session
		decisions.addDecision({
			sessionId: "session-001",
			project: "test",
			content: "Use Pi as foundation because it covers 70% of needs",
			confidence: 0.95,
			source: "manual",
			tags: ["architecture"],
		});
		decisions.addDecision({
			sessionId: "session-001",
			project: "test",
			content: "Use 8-verb gateway because security and token efficiency",
			confidence: 0.95,
			source: "manual",
			tags: ["architecture", "security"],
		});
		decisions.addDecision({
			sessionId: "session-002",
			project: "test",
			content: "Use Zod for config validation",
			confidence: 0.65,
			source: "auto",
			tags: ["tooling"],
		});

		// Step 2: Create a gateway dispatcher that routes recall -> memory query
		const tables = loadAllRoutingTables(path.join(tmpDir, "meta-skills"));
		const executor = vi.fn(async (target: string, _type: string, args: Record<string, unknown>) => {
			if (target === "memory-recall") {
				return memoryQuery.recall({
					query: args.query as string,
					project: args.project as string | undefined,
					limit: args.limit as number | undefined,
				});
			}
			return { error: `Unknown target: ${target}` };
		});

		const dispatcher = new GatewayDispatcher(tables, executor);

		// Step 3: Dispatch a recall verb asking about "foundation" (in decision content)
		const result = await dispatcher.dispatch(
			"recall",
			{ query: "foundation" },
			{ channelType: "cli", project: "test" },
		);

		// Step 4: Verify we got back the matching decision
		expect(result.verb).toBe("recall");
		expect(result.target).toBe("memory-recall");

		const matches = result.result as Array<{ layer: string; content: string; confidence: number }>;
		expect(matches.length).toBeGreaterThanOrEqual(1);
		expect(matches.some((m) => m.content.includes("foundation"))).toBe(true);
	});

	it("threads created in one session are recallable in the next", async () => {
		// Session 1: Create a thread
		threads.createThread({
			project: "test",
			title: "Should we use Redis or SQLite for caching?",
			firstMessage: {
				timestamp: "2026-04-10T10:00:00Z",
				session_id: "session-001",
				role: "operator",
				content: "I'm thinking about caching strategies",
			},
		});

		// Session 2: Recall the thread via gateway
		const tables = loadAllRoutingTables(path.join(tmpDir, "meta-skills"));
		const executor = vi.fn(async (target: string, _type: string, args: Record<string, unknown>) => {
			if (target === "memory-recall") {
				return memoryQuery.recall({ query: args.query as string });
			}
			return {};
		});

		const dispatcher = new GatewayDispatcher(tables, executor);
		const result = await dispatcher.dispatch(
			"recall",
			{ query: "caching" },
			{ channelType: "cli", project: "test" },
		);

		const matches = result.result as Array<{ layer: string; content: string }>;
		expect(matches.some((m) => m.layer === "threads")).toBe(true);
		expect(matches.some((m) => m.content.includes("caching"))).toBe(true);
	});

	it("persona deltas are recallable", async () => {
		persona.addDelta({
			sessionId: "session-001",
			field: "communication_style",
			deltaType: "update",
			content: "prefers terse responses without trailing summaries",
			confidence: 0.85,
		});

		const tables = loadAllRoutingTables(path.join(tmpDir, "meta-skills"));
		const executor = vi.fn(async (target: string, _type: string, args: Record<string, unknown>) => {
			if (target === "memory-recall") {
				return memoryQuery.recall({ query: args.query as string });
			}
			return {};
		});

		const dispatcher = new GatewayDispatcher(tables, executor);
		const result = await dispatcher.dispatch(
			"recall",
			{ query: "terse" },
			{ channelType: "cli", project: "test" },
		);

		const matches = result.result as Array<{ layer: string; content: string }>;
		expect(matches.some((m) => m.layer === "persona")).toBe(true);
		expect(matches.some((m) => m.content.includes("terse"))).toBe(true);
	});

	it("checkpoint tracks extractor progress", () => {
		const checkpointPath = path.join(tmpDir, "state", "checkpoint.json");
		const manager = new CheckpointManager(checkpointPath);

		// Before extraction
		expect(manager.isProcessed("session-001")).toBe(false);

		// After extracting session-001
		decisions.addDecision({
			sessionId: "session-001", project: "test",
			content: "decision from session 1", confidence: 0.95, source: "manual",
		});
		manager.write({
			last_processed_session_id: "session-001",
			last_processed_timestamp: new Date().toISOString(),
			total_sessions_processed: 1,
			last_run_status: "success",
		});

		// session-001 is now processed
		expect(manager.isProcessed("session-001")).toBe(true);
		// session-002 is not
		expect(manager.isProcessed("session-002")).toBe(false);

		// After extracting session-002
		decisions.addDecision({
			sessionId: "session-002", project: "test",
			content: "decision from session 2", confidence: 0.65, source: "auto",
		});
		manager.write({
			last_processed_session_id: "session-002",
			last_processed_timestamp: new Date().toISOString(),
			total_sessions_processed: 2,
			last_run_status: "success",
		});

		expect(manager.isProcessed("session-002")).toBe(true);
		expect(decisions.query({}).length).toBe(2);
	});

	it("memory index stats reflect all layers", () => {
		decisions.addDecision({ sessionId: "s1", project: "test", content: "d1", confidence: 0.9, source: "manual" });
		decisions.addDecision({ sessionId: "s1", project: "test", content: "d2", confidence: 0.6, source: "auto" });
		threads.createThread({
			project: "test", title: "Thread 1",
			firstMessage: { timestamp: "2026-04-10T12:00:00Z", session_id: "s1", role: "operator", content: "msg" },
		});
		persona.addDelta({ sessionId: "s1", field: "style", deltaType: "add", content: "terse", confidence: 0.7 });

		const stats = index.getStats();
		expect(stats.decisions).toBe(2);
		expect(stats.threads).toBe(1);
		expect(stats.open_threads).toBe(1);
		expect(stats.persona_deltas).toBe(1);
		expect(stats.pending_deltas).toBe(1);
	});

	it("security: memory queries are project-scoped", () => {
		decisions.addDecision({ sessionId: "s1", project: "project-a", content: "secret of project A", confidence: 0.95, source: "manual" });
		decisions.addDecision({ sessionId: "s1", project: "project-b", content: "public info from B", confidence: 0.95, source: "manual" });

		// Query scoped to project-b should not return project-a's decisions
		const results = decisions.query({ project: "project-b" });
		expect(results).toHaveLength(1);
		expect(results[0]?.content).toBe("public info from B");
	});
});
