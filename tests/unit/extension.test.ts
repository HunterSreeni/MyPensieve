import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config/schema.js";
import { writeConfig } from "../../src/config/writer.js";
import { createMyPensieveExtension } from "../../src/core/extension.js";

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
			telegram: { enabled: false, tool_escape_hatch: false },
		},
		extractor: { cron: "0 2 * * *" },
	};
}

// Mock ExtensionAPI that records handler registrations
function createMockPi() {
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();

	const pi = {
		on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
			if (!handlers.has(event)) {
				handlers.set(event, []);
			}
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

	return {
		pi,
		handlers,
		fireEvent(event: string, ...args: unknown[]) {
			const eventHandlers = handlers.get(event) ?? [];
			const results = [];
			for (const h of eventHandlers) {
				results.push(h(...args));
			}
			return results;
		},
	};
}

describe("MyPensieve Extension", () => {
	let tmpDir: string;
	let configPath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-ext-test-"));
		configPath = path.join(tmpDir, "config.json");
		// Create logs directory for event logging
		fs.mkdirSync(path.join(tmpDir, "logs", "events"), { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("registers handlers for session_start, before_agent_start, turn_end, session_shutdown", () => {
		const { pi } = createMockPi();
		const factory = createMyPensieveExtension({ configPath, channelType: "cli" });
		factory(pi as never);

		const registeredEvents = pi.on.mock.calls.map((c) => c[0]);
		expect(registeredEvents).toContain("session_start");
		expect(registeredEvents).toContain("before_agent_start");
		expect(registeredEvents).toContain("turn_end");
		expect(registeredEvents).toContain("session_shutdown");
	});

	it("loads config on session_start", () => {
		writeConfig(validConfig(), configPath);
		const { pi, fireEvent } = createMockPi();
		const factory = createMyPensieveExtension({ configPath, channelType: "cli" });
		factory(pi as never);

		// Should not throw
		fireEvent("session_start", { type: "session_start" });
	});

	it("handles missing config gracefully on session_start", () => {
		const { pi, fireEvent } = createMockPi();
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const factory = createMyPensieveExtension({
			configPath: "/nonexistent/config.json",
			channelType: "cli",
		});
		factory(pi as never);

		// Should not throw, but should log error
		fireEvent("session_start", { type: "session_start" });
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("[mypensieve]"), expect.any(String));
		spy.mockRestore();
	});

	it("validates channel binding on session_start", () => {
		const cfg = validConfig();
		cfg.channels.telegram.enabled = false;
		writeConfig(cfg, configPath);

		const { pi, fireEvent } = createMockPi();
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const factory = createMyPensieveExtension({ configPath, channelType: "telegram" });
		factory(pi as never);

		fireEvent("session_start", { type: "session_start" });
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("[mypensieve] Channel binding"),
			expect.any(String),
		);
		spy.mockRestore();
	});

	it("injects persona into system prompt via before_agent_start", () => {
		writeConfig(validConfig(), configPath);
		const { pi, fireEvent } = createMockPi();
		const factory = createMyPensieveExtension({ configPath, channelType: "cli" });
		factory(pi as never);

		// Fire session_start to load config
		fireEvent("session_start", { type: "session_start" });

		// Fire before_agent_start
		const event = {
			type: "before_agent_start",
			prompt: "hello",
			systemPrompt: "You are Pi.",
		};
		const results = fireEvent("before_agent_start", event, {});
		const result = results[0] as { systemPrompt?: string } | undefined;

		expect(result).toBeDefined();
		expect(result?.systemPrompt).toContain("TestUser");
		expect(result?.systemPrompt).toContain("Asia/Kolkata");
		// Should preserve original system prompt
		expect(result?.systemPrompt).toContain("You are Pi.");
	});

	it("before_agent_start loads config if session_start missed", () => {
		writeConfig(validConfig(), configPath);
		const { pi, fireEvent } = createMockPi();
		const factory = createMyPensieveExtension({ configPath, channelType: "cli" });
		factory(pi as never);

		// Skip session_start, go straight to before_agent_start
		const event = {
			type: "before_agent_start",
			prompt: "hello",
			systemPrompt: "Base prompt.",
		};
		const results = fireEvent("before_agent_start", event, {});
		const result = results[0] as { systemPrompt?: string } | undefined;

		expect(result).toBeDefined();
		expect(result?.systemPrompt).toContain("TestUser");
	});

	it("defaults to cli channel type for validation", () => {
		writeConfig(validConfig(), configPath);
		const { pi, fireEvent } = createMockPi();
		const factory = createMyPensieveExtension({ configPath });
		factory(pi as never);

		// session_start should pass validation for cli channel (default)
		fireEvent("session_start", { type: "session_start" });

		const event = {
			type: "before_agent_start",
			prompt: "test",
			systemPrompt: "",
		};
		const results = fireEvent("before_agent_start", event, {});
		const result = results[0] as { systemPrompt?: string } | undefined;
		expect(result?.systemPrompt).toContain("TestUser");
	});
});
