import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMyPensieveExtension } from "../../src/core/extension.js";
import { writeConfig } from "../../src/config/writer.js";
import type { Config } from "../../src/config/schema.js";

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

	it("registers handlers for session_start, context, turn_end, session_shutdown", () => {
		const { pi } = createMockPi();
		const factory = createMyPensieveExtension({ configPath, channelType: "cli" });
		factory(pi as never);

		const registeredEvents = pi.on.mock.calls.map((c) => c[0]);
		expect(registeredEvents).toContain("session_start");
		expect(registeredEvents).toContain("context");
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
		const factory = createMyPensieveExtension({ configPath: "/nonexistent/config.json", channelType: "cli" });
		factory(pi as never);

		// Should not throw, but should log error
		fireEvent("session_start", { type: "session_start" });
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("[mypensieve]"),
			expect.any(String),
		);
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

	it("returns context with operator info", () => {
		writeConfig(validConfig(), configPath);
		const { pi, fireEvent } = createMockPi();
		const factory = createMyPensieveExtension({ configPath, channelType: "cli" });
		factory(pi as never);

		// Fire session_start to load config
		fireEvent("session_start", { type: "session_start" });

		// Fire context event
		const results = fireEvent("context", { type: "context", messages: [] }, {});
		const contextResult = results[0] as { messages: Array<{ role: string; content: string }> };
		expect(contextResult).toBeDefined();
		expect(contextResult.messages).toHaveLength(1);
		expect(contextResult.messages[0]?.content).toContain("TestUser");
		expect(contextResult.messages[0]?.content).toContain("Asia/Kolkata");
		expect(contextResult.messages[0]?.content).toContain("cli");
	});

	it("context handler returns undefined when config not loaded", () => {
		const { pi, fireEvent } = createMockPi();
		const factory = createMyPensieveExtension({ configPath: "/nonexistent", channelType: "cli" });

		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		factory(pi as never);
		spy.mockRestore();

		// Fire session_start (will fail to load config)
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		fireEvent("session_start", { type: "session_start" });
		errSpy.mockRestore();

		// Context should return undefined
		const results = fireEvent("context", { type: "context", messages: [] }, {});
		expect(results[0]).toBeUndefined();
	});

	it("defaults to cli channel type", () => {
		writeConfig(validConfig(), configPath);
		const { pi, fireEvent } = createMockPi();
		const factory = createMyPensieveExtension({ configPath });
		factory(pi as never);

		fireEvent("session_start", { type: "session_start" });

		const results = fireEvent("context", { type: "context", messages: [] }, {});
		const contextResult = results[0] as { messages: Array<{ content: string }> };
		expect(contextResult.messages[0]?.content).toContain("cli");
	});
});
