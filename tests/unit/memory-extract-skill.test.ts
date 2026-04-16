import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/config/schema.js";
import { getProjectBinding } from "../../src/core/session.js";
import { GatewayDispatcher } from "../../src/gateway/dispatcher.js";
import { loadAllRoutingTables } from "../../src/gateway/routing-loader.js";
import type { CompleteFn } from "../../src/memory/extractor.js";
import { closeProject, loadProject } from "../../src/projects/loader.js";
import { type SkillContext, createUnifiedExecutor } from "../../src/skills/executor.js";
import { memoryExtractHandler } from "../../src/skills/memory-extract.js";
import { createDefaultRegistry } from "../../src/skills/registry.js";

const CWD = "/home/sreeni/skill-test";
const SESSION_DIR = `--${CWD.replace(/\//g, "-")}--`;

function makeConfig(): Config {
	return {
		version: 1,
		operator: { name: "Sreeni", timezone: "Asia/Kolkata" },
		default_model: "ollama/test-model",
		tier_routing: { default: "ollama/test-model" },
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
	};
}

function writeSession(sessionsDir: string, id: string) {
	const dir = path.join(sessionsDir, SESSION_DIR);
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `2026-04-14T09-00-00-000Z_${id}.jsonl`);
	const events = [
		{ type: "session", version: 3, id, timestamp: "2026-04-14T09:00:00.000Z", cwd: CWD },
		{
			type: "message",
			id: "u1",
			timestamp: "2026-04-14T09:00:00.000Z",
			message: {
				role: "user",
				content: [{ type: "text", text: "Should we pin the extractor model?" }],
			},
		},
	];
	fs.writeFileSync(file, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
}

const cannedComplete: CompleteFn = async () => ({
	ok: true,
	text: JSON.stringify({
		decisions: [{ content: "Pin extractor to default_model" }],
		thread_updates: [],
		persona_deltas: [],
	}),
});

describe("memory-extract skill", () => {
	let sessionsDir: string;
	let projectsDir: string;
	let ctx: SkillContext;

	beforeEach(() => {
		sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-skill-sess-"));
		projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mp-skill-proj-"));
		const binding = getProjectBinding("cli", CWD);
		const project = loadProject(binding, projectsDir);
		ctx = { project, config: makeConfig(), channelType: "cli", sessionId: "t" };
	});

	afterEach(() => {
		closeProject(ctx.project);
		fs.rmSync(sessionsDir, { recursive: true, force: true });
		fs.rmSync(projectsDir, { recursive: true, force: true });
	});

	it("runs extraction via direct handler invocation (dry-run)", async () => {
		writeSession(sessionsDir, "skill-a");
		const result = await memoryExtractHandler(
			{
				dry_run: true,
				_complete: cannedComplete,
				_sessionsDir: sessionsDir,
				_projectsDir: projectsDir,
			},
			ctx,
		);
		expect(result.success).toBe(true);
		const data = result.data as {
			processed_sessions: number;
			decisions_added: number;
			dry_run: boolean;
		};
		expect(data.processed_sessions).toBe(1);
		expect(data.decisions_added).toBe(1);
		expect(data.dry_run).toBe(true);
	});

	it("reads params from dispatch-style args but strips underscore hooks", async () => {
		// Dispatch-style invocation must NOT honor underscore-prefixed keys —
		// those are test-only and would otherwise let a remote peer point the
		// extractor at arbitrary paths. Here we pass the hooks and confirm they
		// are ignored (extraction runs against the default PI_DIRS, which in a
		// test with no real ~/.pi sessions processes nothing).
		writeSession(sessionsDir, "skill-b");
		const result = await memoryExtractHandler(
			{
				action: "memory.extract",
				params: {
					dry_run: true,
					_complete: cannedComplete,
					_sessionsDir: sessionsDir,
					_projectsDir: projectsDir,
				},
				confirm: false,
			},
			ctx,
		);
		expect(result.success).toBe(true);
		// processed_sessions reflects whatever exists at the REAL PI_DIRS path,
		// not the tmp sessionsDir we tried to smuggle in - so our sample session
		// was ignored on purpose.
		const data = result.data as { processed_sessions: number };
		expect(data.processed_sessions).toBe(0);
	});

	it("fails gracefully when no model is configured", async () => {
		const badCtx: SkillContext = {
			...ctx,
			config: {
				...ctx.config,
				default_model: undefined,
				tier_routing: { default: "not-configured" },
			},
		};
		const result = await memoryExtractHandler({ dry_run: true }, badCtx);
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/No default model/);
	});

	it("is registered in the default skill registry", () => {
		const registry = createDefaultRegistry();
		expect(registry.has("memory-extract")).toBe(true);
	});

	it("is reachable through the dispatch verb routing", async () => {
		// End-to-end: verb dispatch(action="memory.extract") routes to the
		// memory-extract skill. Underscore hooks are stripped in dispatch mode
		// (security hardening), so this asserts the route + skill is wired
		// correctly; it does NOT attempt to redirect sessionsDir from here.
		const registry = createDefaultRegistry();
		const executor = createUnifiedExecutor(registry, ctx);
		const tables = loadAllRoutingTables();
		const dispatcher = new GatewayDispatcher(tables, executor);

		const result = await dispatcher.dispatch(
			"dispatch",
			{
				action: "memory.extract",
				params: { dry_run: true },
				confirm: false,
			},
			{ channelType: "cli", project: ctx.project.binding },
		);
		expect(result.target).toBe("memory-extract");
		expect(result.targetType).toBe("skill");
		expect(result.ruleName).toBe("memory-extract");
		// Run succeeded against real PI_DIRS (whatever is there); we're asserting
		// the wiring, not the extraction content.
		const data = result.result as { processed_sessions: number; dry_run: boolean };
		expect(data.dry_run).toBe(true);
		expect(typeof data.processed_sessions).toBe("number");
	});
});
