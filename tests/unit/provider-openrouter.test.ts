import { describe, expect, it } from "vitest";
import { registerOpenRouterProvider } from "../../src/providers/openrouter.js";

function createMockRegistry() {
	const calls: Array<{ name: string; config: any }> = [];
	return {
		registerProvider(name: string, config: unknown) {
			calls.push({ name, config });
		},
		find() {
			return null;
		},
		calls,
	};
}

describe("OpenRouter provider", () => {
	it("registers with correct base URL and API type", () => {
		const registry = createMockRegistry();
		registerOpenRouterProvider({
			registry: registry as any,
			modelIds: ["anthropic/claude-sonnet-4-6"],
			apiKey: "sk-or-test",
		});
		expect(registry.calls.length).toBe(1);
		expect(registry.calls[0].name).toBe("openrouter");
		expect(registry.calls[0].config.baseUrl).toBe("https://openrouter.ai/api/v1");
		expect(registry.calls[0].config.api).toBe("openai-completions");
		expect(registry.calls[0].config.authHeader).toBe(true);
	});

	it("sets zero costs (billed through OpenRouter account)", () => {
		const registry = createMockRegistry();
		registerOpenRouterProvider({
			registry: registry as any,
			modelIds: ["meta-llama/llama-4-maverick"],
			apiKey: "key",
		});
		const model = registry.calls[0].config.models[0];
		expect(model.cost.input).toBe(0);
		expect(model.cost.output).toBe(0);
	});

	it("uses OpenAI compat flags (no store, no developer role)", () => {
		const registry = createMockRegistry();
		registerOpenRouterProvider({
			registry: registry as any,
			modelIds: ["google/gemini-2.5-pro"],
			apiKey: "key",
		});
		const model = registry.calls[0].config.models[0];
		expect(model.compat.supportsStore).toBe(false);
		expect(model.compat.supportsDeveloperRole).toBe(false);
		expect(model.compat.maxTokensField).toBe("max_tokens");
	});

	it("batches multiple models", () => {
		const registry = createMockRegistry();
		registerOpenRouterProvider({
			registry: registry as any,
			modelIds: ["model-a", "model-b", "model-c"],
			apiKey: "key",
		});
		expect(registry.calls[0].config.models.length).toBe(3);
	});
});
