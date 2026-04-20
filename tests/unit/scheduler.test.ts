import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/config/schema.js";
import { EchoScheduler } from "../../src/core/scheduler/index.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
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
			destinations: [{ type: "local", path: "/tmp/mp-backup-test" }],
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
		...overrides,
	} as Config;
}

describe("EchoScheduler.registerFromConfig", () => {
	let scheduler: EchoScheduler | null = null;

	afterEach(() => {
		scheduler?.stopAll();
		scheduler = null;
	});

	it("registers daily-log, extractor, and backup echoes when all enabled", () => {
		scheduler = new EchoScheduler("UTC");
		scheduler.registerFromConfig(makeConfig());
		const names = scheduler.list().map((e) => e.name);
		expect(names).toContain("daily-log");
		expect(names).toContain("extractor");
		expect(names).toContain("backup");
	});

	it("skips daily-log when disabled", () => {
		scheduler = new EchoScheduler("UTC");
		const cfg = makeConfig();
		cfg.daily_log.enabled = false;
		scheduler.registerFromConfig(cfg);
		const names = scheduler.list().map((e) => e.name);
		expect(names).not.toContain("daily-log");
		expect(names).toContain("extractor");
	});

	it("skips backup when disabled", () => {
		scheduler = new EchoScheduler("UTC");
		const cfg = makeConfig();
		cfg.backup.enabled = false;
		scheduler.registerFromConfig(cfg);
		const names = scheduler.list().map((e) => e.name);
		expect(names).not.toContain("backup");
		expect(names).toContain("extractor");
	});

	it("exposes next-run times in listing", () => {
		scheduler = new EchoScheduler("UTC");
		scheduler.registerFromConfig(makeConfig());
		const extractor = scheduler.list().find((e) => e.name === "extractor");
		expect(extractor).toBeDefined();
		expect(extractor?.nextRun).toBeInstanceOf(Date);
	});
});
