import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Mock secrets directory
const tmpDir = path.join(os.tmpdir(), "multi-reg-test-stable");
const secretsDir = path.join(tmpDir, ".secrets");

vi.mock("../../src/config/paths.js", () => ({
	SECRETS_DIR: path.join(os.tmpdir(), "multi-reg-test-stable", ".secrets"),
}));

import type { Config } from "../../src/config/schema.js";
import {
	buildRegistrationPlan,
	executeRegistrationPlan,
} from "../../src/providers/multi-register.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		version: 1,
		operator: { name: "test", timezone: "UTC" },
		default_model: "ollama/nemotron-3-super:cloud",
		tier_routing: { default: "ollama/nemotron-3-super:cloud" },
		channels: {
			cli: { enabled: true, tool_escape_hatch: false },
			telegram: {
				enabled: false,
				tool_escape_hatch: false,
				allowed_peers: [],
				allow_groups: false,
			},
		},
		embeddings: { enabled: false },
		daily_log: {
			enabled: false,
			cron: "",
			channel: "cli",
			auto_prompt_next_morning_if_missed: false,
		},
		backup: {
			enabled: false,
			cron: "",
			retention_days: 0,
			destinations: [],
			include_secrets: false,
		},
		extractor: { cron: "" },
		...overrides,
	} as Config;
}

function createMockRegistry() {
	const calls: Array<{ name: string; config: { models?: Array<{ id: string }> } }> = [];
	return {
		registerProvider(name: string, config: unknown) {
			calls.push({ name, config: config as { models?: Array<{ id: string }> } });
		},
		find() {
			return null;
		},
		calls,
	};
}

describe("Multi-provider registration", () => {
	beforeEach(() => {
		if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
		fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
	});

	describe("buildRegistrationPlan", () => {
		it("collects default model into plan", () => {
			const plan = buildRegistrationPlan(makeConfig());
			expect(plan.providers.ollama).toEqual(["nemotron-3-super:cloud"]);
			expect(plan.apiKeys.ollama).toBe("");
		});

		it("collects agent_models into plan grouped by provider", () => {
			// Create API key files
			fs.writeFileSync(
				path.join(secretsDir, "anthropic.json"),
				JSON.stringify({ api_key: "sk-ant-test" }),
			);
			fs.chmodSync(path.join(secretsDir, "anthropic.json"), 0o600);

			const plan = buildRegistrationPlan(
				makeConfig({
					agent_models: {
						orchestrator: "ollama/nemotron-3-super:cloud",
						researcher: "anthropic/claude-sonnet-4-6",
						critic: "anthropic/claude-haiku-4-5",
					},
				}),
			);

			expect(plan.providers.ollama).toEqual(["nemotron-3-super:cloud"]);
			expect(plan.providers.anthropic).toContain("claude-sonnet-4-6");
			expect(plan.providers.anthropic).toContain("claude-haiku-4-5");
			expect(plan.apiKeys.anthropic).toBe("sk-ant-test");
		});

		it("deduplicates models within same provider", () => {
			const plan = buildRegistrationPlan(
				makeConfig({
					default_model: "ollama/model-a",
					agent_models: {
						orchestrator: "ollama/model-a",
						researcher: "ollama/model-b",
					},
				}),
			);

			expect(plan.providers.ollama).toEqual(["model-a", "model-b"]);
		});

		it("warns on missing API key for non-ollama provider", () => {
			const plan = buildRegistrationPlan(
				makeConfig({
					agent_models: {
						researcher: "openai/gpt-4.1",
					},
				}),
			);

			expect(plan.warnings.length).toBeGreaterThan(0);
			expect(plan.warnings[0]).toContain("openai");
		});

		it("warns on unsupported provider", () => {
			const plan = buildRegistrationPlan(
				makeConfig({
					agent_models: {
						researcher: "deepseek/model-x",
					},
				}),
			);

			expect(plan.warnings).toEqual(
				expect.arrayContaining([expect.stringContaining("Unsupported provider")]),
			);
		});
	});

	describe("executeRegistrationPlan", () => {
		it("registers each provider with batched models", () => {
			fs.writeFileSync(
				path.join(secretsDir, "anthropic.json"),
				JSON.stringify({ api_key: "sk-test" }),
			);
			fs.chmodSync(path.join(secretsDir, "anthropic.json"), 0o600);

			const plan = buildRegistrationPlan(
				makeConfig({
					agent_models: {
						researcher: "anthropic/claude-sonnet-4-6",
						critic: "anthropic/claude-haiku-4-5",
					},
				}),
			);

			const registry = createMockRegistry();
			executeRegistrationPlan(plan, registry as any);

			// Ollama registered once with default model
			const ollamaCalls = registry.calls.filter((c) => c.name === "ollama");
			expect(ollamaCalls.length).toBe(1);

			// Anthropic registered once with both models batched
			const anthropicCalls = registry.calls.filter((c) => c.name === "anthropic");
			expect(anthropicCalls.length).toBe(1);
			expect(anthropicCalls[0].config.models?.length).toBe(2);
		});

		it("skips providers with missing API keys", () => {
			const plan = buildRegistrationPlan(
				makeConfig({
					agent_models: {
						researcher: "openai/gpt-4.1",
					},
				}),
			);

			const registry = createMockRegistry();
			executeRegistrationPlan(plan, registry as any);

			// Only ollama should be registered (openai has no key)
			expect(registry.calls.length).toBe(1);
			expect(registry.calls[0].name).toBe("ollama");
		});
	});
});
