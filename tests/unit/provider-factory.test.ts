import { describe, expect, it, vi } from "vitest";
import {
	SUPPORTED_PROVIDERS,
	isProviderSupported,
	registerProviderByName,
	registerProviderWithModels,
} from "../../src/providers/factory.js";

// Mock ModelRegistry - minimal interface matching Pi's registerProvider
function createMockRegistry() {
	const calls: Array<{ name: string; config: unknown }> = [];
	return {
		registerProvider(name: string, config: unknown) {
			calls.push({ name, config });
		},
		find(_provider: string, _modelId: string) {
			return null;
		},
		calls,
	};
}

describe("Provider factory", () => {
	describe("SUPPORTED_PROVIDERS", () => {
		it("includes ollama, anthropic, openrouter, openai", () => {
			expect(SUPPORTED_PROVIDERS).toContain("ollama");
			expect(SUPPORTED_PROVIDERS).toContain("anthropic");
			expect(SUPPORTED_PROVIDERS).toContain("openrouter");
			expect(SUPPORTED_PROVIDERS).toContain("openai");
		});
	});

	describe("isProviderSupported", () => {
		it("returns true for supported providers", () => {
			expect(isProviderSupported("ollama")).toBe(true);
			expect(isProviderSupported("anthropic")).toBe(true);
			expect(isProviderSupported("openrouter")).toBe(true);
			expect(isProviderSupported("openai")).toBe(true);
		});

		it("returns false for unknown providers", () => {
			expect(isProviderSupported("deepseek")).toBe(false);
			expect(isProviderSupported("")).toBe(false);
			expect(isProviderSupported("Ollama")).toBe(false);
		});
	});

	describe("registerProviderByName", () => {
		it("dispatches ollama registration", () => {
			const registry = createMockRegistry();
			// Ollama registration calls registry.registerProvider internally
			registerProviderByName("ollama", registry as any, "nemotron-3-super:cloud", "");
			expect(registry.calls.length).toBe(1);
			expect(registry.calls[0].name).toBe("ollama");
		});

		it("throws for unknown provider", () => {
			const registry = createMockRegistry();
			expect(() => registerProviderByName("deepseek", registry as any, "model", "key")).toThrow(
				"Unknown provider 'deepseek'",
			);
		});

		it("error message lists supported providers", () => {
			const registry = createMockRegistry();
			expect(() => registerProviderByName("nope", registry as any, "m", "k")).toThrow(
				"ollama, anthropic, openrouter, openai",
			);
		});
	});

	describe("registerProviderWithModels", () => {
		it("registers multiple ollama models", () => {
			const registry = createMockRegistry();
			registerProviderWithModels("ollama", registry as any, ["model-a", "model-b"], "");
			// Ollama registers one model per call
			expect(registry.calls.length).toBe(2);
			expect(registry.calls[0].name).toBe("ollama");
			expect(registry.calls[1].name).toBe("ollama");
		});

		it("throws for unknown provider", () => {
			const registry = createMockRegistry();
			expect(() => registerProviderWithModels("badprovider", registry as any, ["m"], "k")).toThrow(
				"Unknown provider",
			);
		});
	});
});
