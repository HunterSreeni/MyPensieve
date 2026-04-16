import { describe, expect, it } from "vitest";
import { registerOpenAIProvider } from "../../src/providers/openai.js";

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

describe("OpenAI provider", () => {
	it("registers with correct base URL and API type", () => {
		const registry = createMockRegistry();
		registerOpenAIProvider({
			registry: registry as any,
			modelIds: ["gpt-4.1"],
			apiKey: "sk-test",
		});
		expect(registry.calls.length).toBe(1);
		expect(registry.calls[0].name).toBe("openai");
		expect(registry.calls[0].config.baseUrl).toBe("https://api.openai.com/v1");
		expect(registry.calls[0].config.api).toBe("openai-completions");
		expect(registry.calls[0].config.apiKey).toBe("sk-test");
	});

	it("registers known model with correct metadata", () => {
		const registry = createMockRegistry();
		registerOpenAIProvider({
			registry: registry as any,
			modelIds: ["gpt-4.1"],
			apiKey: "key",
		});
		const model = registry.calls[0].config.models[0];
		expect(model.id).toBe("gpt-4.1");
		expect(model.name).toBe("GPT-4.1");
		expect(model.reasoning).toBe(false);
		expect(model.contextWindow).toBe(1_047_576);
		expect(model.cost.input).toBe(2);
	});

	it("registers o3 as a reasoning model", () => {
		const registry = createMockRegistry();
		registerOpenAIProvider({
			registry: registry as any,
			modelIds: ["o3"],
			apiKey: "key",
		});
		const model = registry.calls[0].config.models[0];
		expect(model.reasoning).toBe(true);
		expect(model.name).toBe("o3");
	});

	it("registers unknown model with fallback metadata", () => {
		const registry = createMockRegistry();
		registerOpenAIProvider({
			registry: registry as any,
			modelIds: ["gpt-future-99"],
			apiKey: "key",
		});
		const model = registry.calls[0].config.models[0];
		expect(model.id).toBe("gpt-future-99");
		expect(model.name).toBe("OpenAI (unknown)");
		expect(model.contextWindow).toBe(128_000);
	});

	it("batches multiple models in a single registerProvider call", () => {
		const registry = createMockRegistry();
		registerOpenAIProvider({
			registry: registry as any,
			modelIds: ["gpt-4.1", "gpt-4.1-mini", "o3"],
			apiKey: "key",
		});
		expect(registry.calls.length).toBe(1);
		expect(registry.calls[0].config.models.length).toBe(3);
	});
});
