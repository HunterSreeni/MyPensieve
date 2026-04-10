import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/config/schema.js";
import { writeConfig } from "../../src/config/writer.js";
import { closeProject, loadProject } from "../../src/projects/loader.js";
import {
	type SkillContext,
	SkillRegistry,
	createUnifiedExecutor,
} from "../../src/skills/executor.js";
import { MCP_CONFIGS, generateMcpServersConfig } from "../../src/skills/mcp-config.js";
import { createDefaultRegistry } from "../../src/skills/registry.js";

function validConfig(): Config {
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

function makeCtx(tmpDir: string): { ctx: SkillContext; cleanup: () => void } {
	const projectsDir = path.join(tmpDir, "projects");
	const configPath = path.join(tmpDir, "config.json");
	writeConfig(validConfig(), configPath);
	const project = loadProject("cli/test", projectsDir);

	return {
		ctx: {
			project,
			config: validConfig(),
			channelType: "cli",
			sessionId: "test-session",
		},
		cleanup: () => closeProject(project),
	};
}

describe("SkillRegistry", () => {
	it("registers and executes a skill", async () => {
		const registry = new SkillRegistry();
		registry.register("test-skill", async (args) => ({
			success: true,
			data: { echo: args.input },
		}));

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-reg-"));
		const { ctx, cleanup } = makeCtx(tmpDir);

		const result = await registry.execute("test-skill", { input: "hello" }, ctx);
		expect(result.success).toBe(true);
		expect((result.data as { echo: string }).echo).toBe("hello");

		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns error for unknown skill", async () => {
		const registry = new SkillRegistry();
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-unk-"));
		const { ctx, cleanup } = makeCtx(tmpDir);

		const result = await registry.execute("nonexistent", {}, ctx);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Unknown skill");

		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("catches skill handler errors", async () => {
		const registry = new SkillRegistry();
		registry.register("throwing-skill", async () => {
			throw new Error("boom");
		});

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-throw-"));
		const { ctx, cleanup } = makeCtx(tmpDir);

		const result = await registry.execute("throwing-skill", {}, ctx);
		expect(result.success).toBe(false);
		expect(result.error).toContain("boom");

		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});
});

describe("Default registry", () => {
	it("has all 9 MVP skills registered", () => {
		const registry = createDefaultRegistry();
		const skills = registry.list();

		expect(skills).toContain("daily-log");
		expect(skills).toContain("memory-recall");
		expect(skills).toContain("researcher");
		expect(skills).toContain("image-edit");
		expect(skills).toContain("video-edit");
		expect(skills).toContain("audio-edit");
		expect(skills).toContain("cve-monitor");
		expect(skills).toContain("blog-seo");
		expect(skills).toContain("playwright-cli");
		expect(skills).toHaveLength(9);
	});
});

describe("Daily-log skill", () => {
	let tmpDir: string;
	let ctx: SkillContext;
	let cleanup: () => void;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-dailylog-"));
		const result = makeCtx(tmpDir);
		ctx = result.ctx;
		cleanup = result.cleanup;
	});

	afterEach(() => {
		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes a daily log entry", async () => {
		const registry = createDefaultRegistry();
		const result = await registry.execute(
			"daily-log",
			{
				action: "write",
				entry: {
					wins: ["shipped Phase 5"],
					blockers: [],
					mood_score: 4,
					mood_text: "good",
					energy_score: 3,
					energy_text: "moderate",
					remember_tomorrow: "start Phase 6",
					weekly_review_flag: false,
				},
			},
			ctx,
		);

		expect(result.success).toBe(true);
		expect((result.data as { stored: boolean }).stored).toBe(true);
	});

	it("reads a daily log entry", async () => {
		const registry = createDefaultRegistry();

		// Write first
		await registry.execute(
			"daily-log",
			{
				action: "write",
				entry: {
					wins: ["test"],
					blockers: [],
					mood_score: 5,
					mood_text: "great",
					energy_score: 5,
					energy_text: "high",
					remember_tomorrow: "",
					weekly_review_flag: false,
				},
			},
			ctx,
		);

		// Read back
		const result = await registry.execute("daily-log", { action: "read" }, ctx);
		expect(result.success).toBe(true);
		expect((result.data as { wins: string[] }).wins).toContain("test");
	});

	it("returns not found for missing date", async () => {
		const registry = createDefaultRegistry();
		const result = await registry.execute("daily-log", { action: "read", date: "1999-01-01" }, ctx);
		expect(result.success).toBe(true);
		expect((result.data as { found: boolean }).found).toBe(false);
	});

	it("returns trends", async () => {
		const registry = createDefaultRegistry();
		const result = await registry.execute("daily-log", { action: "trends" }, ctx);
		expect(result.success).toBe(true);
	});

	it("rejects missing entry on write", async () => {
		const registry = createDefaultRegistry();
		const result = await registry.execute("daily-log", { action: "write" }, ctx);
		expect(result.success).toBe(false);
	});
});

describe("Memory-recall skill", () => {
	let tmpDir: string;
	let ctx: SkillContext;
	let cleanup: () => void;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-recall-"));
		const result = makeCtx(tmpDir);
		ctx = result.ctx;
		cleanup = result.cleanup;
	});

	afterEach(() => {
		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("recalls decisions from memory", async () => {
		// Add a decision first
		ctx.project.decisions.addDecision({
			sessionId: "s1",
			project: "test",
			content: "Use TypeScript for the MVP",
			confidence: 0.95,
			source: "manual",
		});

		const registry = createDefaultRegistry();
		const result = await registry.execute("memory-recall", { query: "TypeScript" }, ctx);
		expect(result.success).toBe(true);
		const data = result.data as { matches: Array<{ content: string }>; total: number };
		expect(data.total).toBeGreaterThanOrEqual(1);
	});

	it("rejects missing query", async () => {
		const registry = createDefaultRegistry();
		const result = await registry.execute("memory-recall", {}, ctx);
		expect(result.success).toBe(false);
	});
});

describe("Researcher skill", () => {
	it("returns structured research with citations", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-research-"));
		const { ctx, cleanup } = makeCtx(tmpDir);

		const registry = createDefaultRegistry();
		const result = await registry.execute("researcher", { topic: "AI safety", depth: "deep" }, ctx);

		expect(result.success).toBe(true);
		const data = result.data as {
			synthesis: string;
			citations: Array<{ index: number }>;
			query_plan: string[];
		};
		expect(data.synthesis).toContain("AI safety");
		expect(data.citations.length).toBeGreaterThan(0);
		expect(data.query_plan.length).toBeGreaterThan(1); // deep = multiple queries

		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});
});

describe("Blog-SEO skill", () => {
	it("scores a blog post", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-seo-"));
		const { ctx, cleanup } = makeCtx(tmpDir);

		const registry = createDefaultRegistry();
		const longPost = `${"This is a test blog post about AI safety and its implications. ".repeat(30)}What do you think about AI safety?`;
		const result = await registry.execute(
			"blog-seo",
			{
				prompt: longPost,
				options: { keyword: "AI safety" },
			},
			ctx,
		);

		expect(result.success).toBe(true);
		const data = result.data as { seo_score: number; suggestions: string[] };
		expect(data.seo_score).toBeGreaterThan(0);
		expect(data.seo_score).toBeLessThanOrEqual(100);

		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});
});

describe("Playwright-CLI skill", () => {
	it("blocks on Telegram channel", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-pw-"));
		const { ctx, cleanup } = makeCtx(tmpDir);
		ctx.channelType = "telegram";

		const registry = createDefaultRegistry();
		const result = await registry.execute("playwright-cli", { source: "https://example.com" }, ctx);
		expect(result.success).toBe(false);
		expect(result.error).toContain("not available on Telegram");

		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("delegates to Playwright MCP on CLI", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-pw2-"));
		const { ctx, cleanup } = makeCtx(tmpDir);

		const registry = createDefaultRegistry();
		const result = await registry.execute("playwright-cli", { source: "https://example.com" }, ctx);
		expect(result.success).toBe(true);
		expect((result.data as { status: string }).status).toBe("mcp_delegation");

		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});
});

describe("MCP configs", () => {
	it("has 6 MCPs configured", () => {
		expect(MCP_CONFIGS).toHaveLength(6);
	});

	it("all MCPs are zero-auth", () => {
		expect(MCP_CONFIGS.every((m) => !m.authRequired)).toBe(true);
	});

	it("generates valid MCP server config", () => {
		const config = generateMcpServersConfig();
		expect(Object.keys(config)).toHaveLength(6);
		expect(config.datetime).toBeDefined();
		expect(config.playwright).toBeDefined();
		expect(config["duckduckgo-search"]).toBeDefined();
		expect(config["whisper-local"]).toBeDefined();
		expect(config["gh-cli"]).toBeDefined();
		expect(config["cve-intel"]).toBeDefined();
	});
});

describe("Unified executor", () => {
	it("routes skill calls to registry", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-unified-"));
		const { ctx, cleanup } = makeCtx(tmpDir);
		const registry = createDefaultRegistry();
		const executor = createUnifiedExecutor(registry, ctx);

		const result = await executor("memory-recall", "skill", { query: "test" });
		expect(result).toBeDefined();

		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns stub for unregistered skills", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-unified2-"));
		const { ctx, cleanup } = makeCtx(tmpDir);
		const registry = createDefaultRegistry();
		const executor = createUnifiedExecutor(registry, ctx);

		const result = await executor("nonexistent", "skill", {});
		expect((result as { status: string }).status).toBe("not_registered");

		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns MCP stub for MCP targets", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-mcp-"));
		const { ctx, cleanup } = makeCtx(tmpDir);
		const registry = createDefaultRegistry();
		const executor = createUnifiedExecutor(registry, ctx);

		const result = await executor("duckduckgo-search", "mcp", { query: "test" });
		expect((result as { status: string }).status).toBe("mcp_not_connected");

		cleanup();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});
});
