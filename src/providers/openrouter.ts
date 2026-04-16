import type { ProviderRegistrationOptions } from "./types.js";

/**
 * Register one or more OpenRouter models into Pi's ModelRegistry.
 *
 * OpenRouter is a model aggregator with an OpenAI-compatible API.
 * Model IDs use the OpenRouter format (e.g. "anthropic/claude-sonnet-4-6",
 * "google/gemini-2.5-pro", "meta-llama/llama-4-maverick").
 *
 * Costs are set to zero because OpenRouter handles billing per-request
 * through the user's OpenRouter account. Context window and max tokens
 * use conservative defaults since model capabilities vary widely.
 *
 * API key from https://openrouter.ai/keys
 */
export function registerOpenRouterProvider({
	registry,
	modelIds,
	apiKey,
}: ProviderRegistrationOptions): void {
	const models = modelIds.map((id) => ({
		id,
		name: `OpenRouter: ${id}`,
		api: "openai-completions" as const,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 32_000,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			maxTokensField: "max_tokens" as const,
		},
	}));

	registry.registerProvider("openrouter", {
		baseUrl: "https://openrouter.ai/api/v1",
		apiKey,
		api: "openai-completions",
		authHeader: true,
		models,
	});
}
