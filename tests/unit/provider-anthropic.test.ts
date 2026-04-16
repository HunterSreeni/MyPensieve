import { describe, expect, it } from "vitest";
import { registerAnthropicProvider } from "../../src/providers/anthropic.js";

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

describe("Anthropic provider", () => {
	it("registers with correct base URL and API type", () => {
		const registry = createMockRegistry();
		registerAnthropicProvider({
			registry: registry as any,
			modelIds: ["claude-sonnet-4-6"],
			apiKey: "sk-ant-test",
		});
		expect(registry.calls.length).toBe(1);
		expect(registry.calls[0].name).toBe("anthropic");
		expect(registry.calls[0].config.baseUrl).toBe("https://api.anthropic.com");
		expect(registry.calls[0].config.api).toBe("anthropic-messages");
		expect(registry.calls[0].config.apiKey).toBe("sk-ant-test");
	});

	it("registers known model with correct metadata", () => {
		const registry = createMockRegistry();
		registerAnthropicProvider({
			registry: registry as any,
			modelIds: ["claude-sonnet-4-6"],
			apiKey: "key",
		});
		const model = registry.calls[0].config.models[0];
		expect(model.id).toBe("claude-sonnet-4-6");
		expect(model.name).toBe("Claude Sonnet 4.6");
		expect(model.reasoning).toBe(true);
		expect(model.contextWindow).toBe(200_000);
		expect(model.cost.input).toBe(3);
	});

	it("registers unknown model with fallback metadata", () => {
		const registry = createMockRegistry();
		registerAnthropicProvider({
			registry: registry as any,
			modelIds: ["claude-future-99"],
			apiKey: "key",
		});
		const model = registry.calls[0].config.models[0];
		expect(model.id).toBe("claude-future-99");
		expect(model.name).toBe("Claude (unknown)");
		expect(model.contextWindow).toBe(200_000);
	});

	it("batches multiple models in a single registerProvider call", () => {
		const registry = createMockRegistry();
		registerAnthropicProvider({
			registry: registry as any,
			modelIds: ["claude-sonnet-4-6", "claude-haiku-4-5"],
			apiKey: "key",
		});
		expect(registry.calls.length).toBe(1);
		expect(registry.calls[0].config.models.length).toBe(2);
		expect(registry.calls[0].config.models[0].id).toBe("claude-sonnet-4-6");
		expect(registry.calls[0].config.models[1].id).toBe("claude-haiku-4-5");
	});

	it("matches versioned model IDs by prefix", () => {
		const registry = createMockRegistry();
		registerAnthropicProvider({
			registry: registry as any,
			modelIds: ["claude-sonnet-4-6-20260414"],
			apiKey: "key",
		});
		const model = registry.calls[0].config.models[0];
		expect(model.name).toBe("Claude Sonnet 4.6");
	});
});
