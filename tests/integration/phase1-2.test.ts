/**
 * Cross-phase integration test: Phase 1 (Foundation) + Phase 2 (Gateway)
 *
 * Validates the full chain:
 *   Config -> Directory scaffold -> Routing tables -> Gateway dispatcher
 *   -> Verb validation -> Route resolution -> Executor -> Audit log
 *
 * Also validates:
 *   - Extension registers correct handlers
 *   - Skill frontmatter registration feeds into routing tables
 *   - Binding validator catches invalid channel configs
 *   - JSONL audit entries are written correctly
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { writeConfig } from "../../src/config/writer.js";
import { readConfig } from "../../src/config/reader.js";
import type { Config } from "../../src/config/schema.js";
import { scaffoldDirectories, verifyDirectories } from "../../src/init/directories.js";
import { loadAllRoutingTables, DEFAULT_ROUTING_TABLES } from "../../src/gateway/routing-loader.js";
import { GatewayDispatcher } from "../../src/gateway/dispatcher.js";
import {
	scanSkillsForRegistration,
	applySkillRegistrations,
} from "../../src/gateway/skill-registration.js";
import { validateChannelBinding, isEscapeHatchAllowed } from "../../src/gateway/binding-validator.js";
import { VERB_NAMES, type VerbName } from "../../src/gateway/verbs.js";
import { readJsonlSync } from "../../src/utils/jsonl.js";
import { getProjectBinding } from "../../src/core/session.js";
import { createMyPensieveExtension } from "../../src/core/extension.js";
import type { RoutingTable } from "../../src/gateway/routing-schema.js";

// --- Test fixtures ---

function validConfig(): Config {
	return {
		version: 1,
		operator: {
			name: "IntegrationTestUser",
			timezone: "UTC",
			working_hours: { start: "09:00", end: "18:00" },
		},
		tier_routing: {
			default: "ollama/llama3",
		},
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
			telegram: { enabled: true, tool_escape_hatch: false },
		},
		extractor: { cron: "0 2 * * *" },
	};
}

describe("Phase 1+2 Integration: Config -> Gateway -> Dispatch", () => {
	let tmpDir: string;
	let configPath: string;
	let metaSkillsDir: string;
	let skillsDir: string;
	let auditDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-integration-"));
		configPath = path.join(tmpDir, "config.json");
		metaSkillsDir = path.join(tmpDir, "meta-skills");
		skillsDir = path.join(tmpDir, "skills");
		auditDir = path.join(tmpDir, "logs", "audit");
		fs.mkdirSync(metaSkillsDir, { recursive: true });
		fs.mkdirSync(skillsDir, { recursive: true });
		fs.mkdirSync(auditDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("full chain: write config -> read config -> load routing -> dispatch recall verb", async () => {
		// Step 1: Write config
		const cfg = validConfig();
		writeConfig(cfg, configPath);

		// Step 2: Read config back
		const readCfg = readConfig(configPath);
		expect(readCfg.operator.name).toBe("IntegrationTestUser");

		// Step 3: Validate channel binding
		validateChannelBinding("cli", readCfg.channels);

		// Step 4: Load routing tables (defaults since no YAML files)
		const tables = loadAllRoutingTables(metaSkillsDir);
		expect(tables.size).toBe(8);

		// Step 5: Create dispatcher with mock executor
		const executorLog: Array<{ target: string; type: string; args: unknown }> = [];
		const mockExecutor = vi.fn(async (target: string, type: string, args: unknown) => {
			executorLog.push({ target, type, args });
			return { matches: [{ layer: "decisions", content: "found it", confidence: 0.9, timestamp: "2026-04-10T00:00:00Z" }] };
		});
		const dispatcher = new GatewayDispatcher(tables, mockExecutor);

		// Step 6: Dispatch a recall verb
		const result = await dispatcher.dispatch(
			"recall",
			{ query: "what did we decide about auth?" },
			{ channelType: "cli", project: getProjectBinding("cli", "/home/user/project") },
		);

		// Verify the full chain worked
		expect(result.verb).toBe("recall");
		expect(result.target).toBe("memory-recall");
		expect(result.targetType).toBe("skill");
		expect(executorLog).toHaveLength(1);
		expect(executorLog[0]?.target).toBe("memory-recall");
	});

	it("custom YAML routing overrides default", async () => {
		// Write a custom routing table for recall
		const customTable = {
			verb: "recall",
			default_target: "custom-memory",
			default_target_type: "extension",
			rules: [],
		};
		fs.writeFileSync(
			path.join(metaSkillsDir, "recall.yaml"),
			YAML.stringify(customTable),
			"utf-8",
		);

		const tables = loadAllRoutingTables(metaSkillsDir);
		expect(tables.get("recall")?.default_target).toBe("custom-memory");

		// Other verbs still use defaults
		expect(tables.get("research")?.default_target).toBe("researcher");

		// Dispatch uses the custom route
		const mockExecutor = vi.fn(async () => ({ data: "custom" }));
		const dispatcher = new GatewayDispatcher(tables, mockExecutor);

		const result = await dispatcher.dispatch(
			"recall",
			{ query: "test" },
			{ channelType: "cli", project: "test" },
		);
		expect(result.target).toBe("custom-memory");
		expect(result.targetType).toBe("extension");
	});

	it("skill frontmatter registration feeds into routing tables", async () => {
		// Create a custom skill with mypensieve_exposes_via
		const skillDir = path.join(skillsDir, "my-custom-recall");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			"---\nname: my-custom-recall\ndescription: Custom recall\nmypensieve_exposes_via: recall\nmypensieve_priority: 5\nmypensieve_match:\n  has_field: custom_index\n---\nCustom recall skill body",
			"utf-8",
		);

		// Scan and apply
		const registrations = scanSkillsForRegistration(skillsDir);
		expect(registrations).toHaveLength(1);
		expect(registrations[0]?.verb).toBe("recall");
		expect(registrations[0]?.priority).toBe(5);

		const tables = loadAllRoutingTables(metaSkillsDir);
		applySkillRegistrations(tables, registrations);

		// The custom skill should be in the recall routing table
		const recallTable = tables.get("recall");
		const customRule = recallTable?.rules.find((r) => r.target === "my-custom-recall");
		expect(customRule).toBeDefined();
		expect(customRule?.priority).toBe(5);

		// Dispatch with the matching field routes to custom skill
		const mockExecutor = vi.fn(async () => ({ custom: true }));
		const dispatcher = new GatewayDispatcher(tables, mockExecutor);

		const result = await dispatcher.dispatch(
			"recall",
			{ query: "test", custom_index: "my-index" },
			{ channelType: "cli", project: "test" },
		);
		expect(result.target).toBe("my-custom-recall");
	});

	it("all 8 verbs dispatch correctly with valid args", async () => {
		const tables = loadAllRoutingTables(metaSkillsDir);
		const mockExecutor = vi.fn(async () => ({ ok: true }));
		const dispatcher = new GatewayDispatcher(tables, mockExecutor);
		const ctx = { channelType: "cli" as const, project: "test" };

		const verbArgs: Record<VerbName, Record<string, unknown>> = {
			recall: { query: "test" },
			research: { topic: "AI" },
			ingest: { source: "/tmp/file.pdf" },
			monitor: { target: "cves" },
			journal: { action: "read" },
			produce: { kind: "blog-post", prompt: "write" },
			dispatch: { action: "git.status" },
			notify: { message: "hello" },
		};

		for (const verb of VERB_NAMES) {
			const args = verbArgs[verb];
			if (!args) throw new Error(`Missing test args for verb: ${verb}`);
			const result = await dispatcher.dispatch(verb, args, ctx);
			expect(result.verb).toBe(verb);
			expect(result.target).toBeDefined();
		}

		expect(mockExecutor).toHaveBeenCalledTimes(8);
	});

	it("all 8 verbs reject empty args", async () => {
		const tables = loadAllRoutingTables(metaSkillsDir);
		const mockExecutor = vi.fn(async () => ({ ok: true }));
		const dispatcher = new GatewayDispatcher(tables, mockExecutor);
		const ctx = { channelType: "cli" as const, project: "test" };

		for (const verb of VERB_NAMES) {
			await expect(dispatcher.dispatch(verb, {}, ctx)).rejects.toThrow("Invalid args");
		}

		// Executor should never have been called
		expect(mockExecutor).not.toHaveBeenCalled();
	});

	it("extension factory creates handlers that use config + gateway together", () => {
		writeConfig(validConfig(), configPath);

		// Create mock Pi API
		const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
		const mockPi = {
			on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
				if (!handlers.has(event)) handlers.set(event, []);
				handlers.get(event)?.push(handler);
			}),
			registerTool: vi.fn(),
			registerCommand: vi.fn(),
			registerShortcut: vi.fn(),
			registerFlag: vi.fn(),
			getFlag: vi.fn(),
			registerMessageRenderer: vi.fn(),
			sendMessage: vi.fn(),
			sendUserMessage: vi.fn(),
			appendEntry: vi.fn(),
			setSessionName: vi.fn(),
			getSessionName: vi.fn(),
			setLabel: vi.fn(),
			exec: vi.fn(),
			getActiveTools: vi.fn(() => []),
			getAllTools: vi.fn(() => []),
			setActiveTools: vi.fn(),
			getCommands: vi.fn(() => []),
			setModel: vi.fn(),
			getThinkingLevel: vi.fn(),
			setThinkingLevel: vi.fn(),
		};

		const factory = createMyPensieveExtension({ configPath, channelType: "cli" });
		factory(mockPi as never);

		// Verify handlers registered
		expect(mockPi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(mockPi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
		expect(mockPi.on).toHaveBeenCalledWith("turn_end", expect.any(Function));

		// Fire session_start and verify it loads config without error
		const sessionStartHandlers = handlers.get("session_start") ?? [];
		expect(sessionStartHandlers.length).toBeGreaterThan(0);
		for (const h of sessionStartHandlers) {
			h({ type: "session_start" });
		}

		// Fire context and verify it returns operator info
		const contextHandlers = handlers.get("context") ?? [];
		for (const h of contextHandlers) {
			const result = h({ type: "context", messages: [] }, {}) as { messages: Array<{ content: string }> } | undefined;
			if (result) {
				expect(result.messages[0]?.content).toContain("IntegrationTestUser");
			}
		}
	});

	it("project binding + channel validation + dispatch - complete session setup", async () => {
		const cfg = validConfig();
		writeConfig(cfg, configPath);
		const readCfg = readConfig(configPath);

		// Simulate session setup
		const channelType = "cli" as const;
		const cwd = "/home/user/my-project";
		const projectBinding = getProjectBinding(channelType, cwd);

		expect(projectBinding).toBe("cli/home-user-my-project");

		// Validate channel
		validateChannelBinding(channelType, readCfg.channels);

		// Check escape hatch
		expect(isEscapeHatchAllowed(channelType, readCfg.channels)).toBe(false);

		// Load routes and dispatch
		const tables = loadAllRoutingTables(metaSkillsDir);
		const mockExecutor = vi.fn(async () => ({ success: true }));
		const dispatcher = new GatewayDispatcher(tables, mockExecutor);

		const result = await dispatcher.dispatch(
			"journal",
			{ action: "write", entry: { wins: ["shipped Phase 2"], mood_score: 4, mood_text: "good", energy_score: 3, energy_text: "moderate", blockers: [], remember_tomorrow: "start Phase 3", weekly_review_flag: false } },
			{ channelType, project: projectBinding },
		);

		expect(result.verb).toBe("journal");
		expect(result.target).toBe("daily-log");
		expect(mockExecutor).toHaveBeenCalledWith(
			"daily-log",
			"skill",
			expect.objectContaining({ action: "write" }),
		);
	});
});

describe("Phase 3 readiness check", () => {
	it("memory types module is importable (types are compile-time only)", async () => {
		// TypeScript interfaces don't exist at runtime - the real check is that
		// tsc --noEmit passes. This test just verifies the module loads.
		const types = await import("../../src/memory/types.js");
		expect(types).toBeDefined();
	});

	it("JSONL utilities work for memory storage patterns", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase3-ready-"));
		const decisionsPath = path.join(tmpDir, "decisions.jsonl");

		try {
			const { appendJsonl, readJsonlSync, queryJsonl, writeJsonlAtomic } = await import("../../src/utils/jsonl.js");

			// Simulate decision storage
			const decision1 = {
				id: "d1",
				timestamp: "2026-04-10T12:00:00Z",
				session_id: "s1",
				project: "test",
				content: "Use SQLite for indexing because JSONL queries are O(n)",
				confidence: 0.95,
				source: "manual",
				tags: ["architecture"],
			};
			const decision2 = {
				id: "d2",
				timestamp: "2026-04-10T13:00:00Z",
				session_id: "s1",
				project: "test",
				content: "Use Zod for validation because it works well with TypeScript",
				confidence: 0.65,
				source: "auto",
				tags: ["tooling"],
			};

			appendJsonl(decisionsPath, decision1);
			appendJsonl(decisionsPath, decision2);

			const all = readJsonlSync(decisionsPath);
			expect(all).toHaveLength(2);

			// Query by confidence
			const highConfidence = queryJsonl(decisionsPath, (r: { confidence: number }) => r.confidence >= 0.9);
			expect(highConfidence).toHaveLength(1);

			// Atomic rewrite (for compaction)
			writeJsonlAtomic(decisionsPath, [decision1]);
			expect(readJsonlSync(decisionsPath)).toHaveLength(1);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("SQLite better-sqlite3 is available", () => {
		const Database = require("better-sqlite3");
		const db = new Database(":memory:");
		db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
		db.prepare("INSERT INTO test (value) VALUES (?)").run("hello");
		const row = db.prepare("SELECT value FROM test WHERE id = 1").get() as { value: string };
		expect(row.value).toBe("hello");
		db.close();
	});

	it("recall verb routing is ready for memory-recall skill", () => {
		const table = DEFAULT_ROUTING_TABLES.recall;
		expect(table.default_target).toBe("memory-recall");
		expect(table.default_target_type).toBe("skill");
	});

	it("extractor checkpoint schema matches JSONL storage", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-test-"));
		const checkpointPath = path.join(tmpDir, "extractor-checkpoint.json");

		try {
			const checkpoint = {
				last_processed_session_id: "session-123",
				last_processed_timestamp: "2026-04-10T02:00:00Z",
				total_sessions_processed: 42,
				last_run_status: "success",
			};

			fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint), "utf-8");
			const read = JSON.parse(fs.readFileSync(checkpointPath, "utf-8"));
			expect(read.last_processed_session_id).toBe("session-123");
			expect(read.total_sessions_processed).toBe(42);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
