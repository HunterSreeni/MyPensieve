import type { ProviderRegistrationOptions } from "./types.js";

/**
 * Known Anthropic model catalog.
 * Costs are per million tokens in USD.
 * Source: https://docs.anthropic.com/en/docs/about-claude/models
 */
type ModelInput = ("text" | "image")[];

const ANTHROPIC_MODELS: Record<
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
	"claude-opus-4-6": {
		name: "Claude Opus 4.6",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	"claude-sonnet-4-6": {
		name: "Claude Sonnet 4.6",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	"claude-haiku-4-5": {
		name: "Claude Haiku 4.5",
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
		contextWindow: 200_000,
		maxTokens: 8_192,
	},
};

/** Sensible defaults for unknown Anthropic model IDs */
const ANTHROPIC_FALLBACK = {
	name: "Claude (unknown)",
	reasoning: false,
	input: ["text", "image"] as ModelInput,
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	contextWindow: 200_000,
	maxTokens: 64_000,
};

/**
 * Register one or more Anthropic models into Pi's ModelRegistry.
 *
 * Uses the Anthropic Messages API (`api: "anthropic-messages"`).
 * API key is read from ~/.mypensieve/.secrets/anthropic.json.
 */
export function registerAnthropicProvider({
	registry,
	modelIds,
	apiKey,
}: ProviderRegistrationOptions): void {
	const models = modelIds.map((id) => {
		// Match by prefix to handle versioned IDs (e.g. claude-sonnet-4-6-20260414)
		const known =
			ANTHROPIC_MODELS[id] ??
			Object.entries(ANTHROPIC_MODELS).find(([k]) => id.startsWith(k))?.[1] ??
			ANTHROPIC_FALLBACK;

		return {
			id,
			name: known.name,
			api: "anthropic-messages" as const,
			reasoning: known.reasoning,
			input: known.input,
			cost: known.cost,
			contextWindow: known.contextWindow,
			maxTokens: known.maxTokens,
		};
	});

	registry.registerProvider("anthropic", {
		baseUrl: "https://api.anthropic.com",
		apiKey,
		api: "anthropic-messages",
		models,
	});
}
