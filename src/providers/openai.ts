import type { ProviderRegistrationOptions } from "./types.js";

/**
 * Known OpenAI model catalog.
 * Costs are per million tokens in USD.
 * Source: https://platform.openai.com/docs/models
 */
type ModelInput = ("text" | "image")[];

const OPENAI_MODELS: Record<
	string,
	{
		name: string;
		reasoning: boolean;
		input: ModelInput;
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
		contextWindow: number;
		maxTokens: number;
	}
> = {
	"gpt-4.1": {
		name: "GPT-4.1",
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 1_047_576,
		maxTokens: 32_768,
	},
	"gpt-4.1-mini": {
		name: "GPT-4.1 Mini",
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 1_047_576,
		maxTokens: 32_768,
	},
	"gpt-4.1-nano": {
		name: "GPT-4.1 Nano",
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },
		contextWindow: 1_047_576,
		maxTokens: 32_768,
	},
	o3: {
		name: "o3",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 100_000,
	},
	"o4-mini": {
		name: "o4-mini",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 100_000,
	},
};

/** Sensible defaults for unknown OpenAI model IDs */
const OPENAI_FALLBACK = {
	name: "OpenAI (unknown)",
	reasoning: false,
	input: ["text"] as ModelInput,
	cost: { input: 2, output: 8, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 16_384,
};

/**
 * Register one or more OpenAI models into Pi's ModelRegistry.
 *
 * Uses the OpenAI Completions API (`api: "openai-completions"`).
 * API key from https://platform.openai.com/api-keys
 */
export function registerOpenAIProvider({
	registry,
	modelIds,
	apiKey,
}: ProviderRegistrationOptions): void {
	const models = modelIds.map((id) => {
		const known =
			OPENAI_MODELS[id] ??
			Object.entries(OPENAI_MODELS).find(([k]) => id.startsWith(k))?.[1] ??
			OPENAI_FALLBACK;

		return {
			id,
			name: known.name,
			api: "openai-completions" as const,
			reasoning: known.reasoning,
			input: known.input,
			cost: known.cost,
			contextWindow: known.contextWindow,
			maxTokens: known.maxTokens,
		};
	});

	registry.registerProvider("openai", {
		baseUrl: "https://api.openai.com/v1",
		apiKey,
		api: "openai-completions",
		models,
	});
}
