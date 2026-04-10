import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigReadError, readConfig } from "../../src/config/reader.js";
import { type Config, ConfigSchema } from "../../src/config/schema.js";
import { ConfigWriteError, writeConfig } from "../../src/config/writer.js";

// --- Test fixtures ---

function validConfig(): Config {
	return {
		version: 1,
		operator: {
			name: "TestUser",
			timezone: "Asia/Kolkata",
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

// --- Schema tests ---

describe("ConfigSchema", () => {
	it("accepts a valid config", () => {
		const result = ConfigSchema.safeParse(validConfig());
		expect(result.success).toBe(true);
	});

	it("rejects missing version", () => {
		const cfg = { ...validConfig(), version: undefined };
		const result = ConfigSchema.safeParse(cfg);
		expect(result.success).toBe(false);
	});

	it("rejects wrong version number", () => {
		const cfg = { ...validConfig(), version: 2 };
		const result = ConfigSchema.safeParse(cfg);
		expect(result.success).toBe(false);
	});

	it("rejects empty operator name", () => {
		const cfg = validConfig();
		cfg.operator.name = "";
		const result = ConfigSchema.safeParse(cfg);
		expect(result.success).toBe(false);
	});

	it("rejects invalid working hours format", () => {
		const cfg = validConfig();
		cfg.operator.working_hours = { start: "9am", end: "6pm" };
		const result = ConfigSchema.safeParse(cfg);
		expect(result.success).toBe(false);
	});

	it("accepts config without working hours", () => {
		const cfg = validConfig();
		cfg.operator.working_hours = undefined;
		const result = ConfigSchema.safeParse(cfg);
		expect(result.success).toBe(true);
	});

	it("enforces telegram escape hatch is always false", () => {
		const cfg = validConfig();
		// @ts-expect-error - intentionally testing runtime validation
		cfg.channels.telegram.tool_escape_hatch = true;
		const result = ConfigSchema.safeParse(cfg);
		expect(result.success).toBe(false);
	});

	it("rejects empty tier routing providers", () => {
		const cfg = validConfig();
		cfg.tier_routing.cheap = "";
		const result = ConfigSchema.safeParse(cfg);
		expect(result.success).toBe(false);
	});

	it("rejects invalid backup destination type", () => {
		const cfg = validConfig();
		// @ts-expect-error - intentionally testing runtime validation
		cfg.backup.destinations = [{ type: "s3", path: "bucket" }];
		const result = ConfigSchema.safeParse(cfg);
		expect(result.success).toBe(false);
	});

	it("rejects retention days less than 1", () => {
		const cfg = validConfig();
		cfg.backup.retention_days = 0;
		const result = ConfigSchema.safeParse(cfg);
		expect(result.success).toBe(false);
	});
});

// --- Reader/Writer tests ---

describe("Config reader/writer", () => {
	let tmpDir: string;
	let configPath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-test-"));
		configPath = path.join(tmpDir, "config.json");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes and reads a valid config", () => {
		const cfg = validConfig();
		writeConfig(cfg, configPath);
		const read = readConfig(configPath);
		expect(read).toEqual(cfg);
	});

	it("sets file to mode 0444 after write", () => {
		writeConfig(validConfig(), configPath);
		const stats = fs.statSync(configPath);
		const mode = stats.mode & 0o777;
		expect(mode).toBe(0o444);
	});

	it("throws ConfigReadError for missing file", () => {
		expect(() => readConfig("/nonexistent/config.json")).toThrow(ConfigReadError);
	});

	it("throws ConfigReadError for invalid JSON", () => {
		fs.writeFileSync(configPath, "not json{{{", "utf-8");
		expect(() => readConfig(configPath)).toThrow(ConfigReadError);
	});

	it("throws ConfigReadError for valid JSON but invalid schema", () => {
		fs.writeFileSync(configPath, JSON.stringify({ version: 99 }), "utf-8");
		expect(() => readConfig(configPath)).toThrow(ConfigReadError);
	});

	it("throws ConfigWriteError for invalid config", () => {
		const bad = { version: 99 } as unknown as Config;
		expect(() => writeConfig(bad, configPath)).toThrow(ConfigWriteError);
	});

	it("overwrites existing config atomically", () => {
		const cfg1 = validConfig();
		writeConfig(cfg1, configPath);

		const cfg2 = validConfig();
		cfg2.operator.name = "UpdatedUser";
		writeConfig(cfg2, configPath);

		const read = readConfig(configPath);
		expect(read.operator.name).toBe("UpdatedUser");
	});
});
