import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { registerAnthropicProvider } from "./anthropic.js";
import { getOllamaHost, registerOllamaProvider } from "./ollama.js";
import { registerOpenAIProvider } from "./openai.js";
import { registerOpenRouterProvider } from "./openrouter.js";
import type { RegisterProviderFn } from "./types.js";

/**
 * Supported provider names. Adding a new provider means:
 * 1. Create src/providers/{name}.ts with a RegisterProviderFn export
 * 2. Add the import + entry to REGISTRARS below
 * 3. Add the provider to this list
 */
export const SUPPORTED_PROVIDERS = ["ollama", "anthropic", "openrouter", "openai"] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

/**
 * Provider registration dispatch table.
 * Each entry wraps the provider-specific registration function.
 *
 * Ollama is special: it ignores apiKey and uses host-based auth.
 * All others read apiKey from .secrets/{provider}.json.
 */
const REGISTRARS: Record<string, RegisterProviderFn> = {
	ollama: ({ registry, modelIds }) => {
		const host = getOllamaHost();
		// AI-DEV Note: Register all Ollama models in a single batched call.
		// Pi's registerProvider replaces all models, so looping over them
		// one by one would overwrite the previously registered models.
		registerOllamaProvider(registry, host, modelIds);
	},
	anthropic: registerAnthropicProvider,
	openrouter: registerOpenRouterProvider,
	openai: registerOpenAIProvider,
};

/**
 * Register a single model for a provider into Pi's ModelRegistry.
 * Convenience wrapper that calls registerProviderWithModels with one model.
 */
export function registerProviderByName(
	name: string,
	registry: ModelRegistry,
	modelId: string,
	apiKey: string,
): void {
	registerProviderWithModels(name, registry, [modelId], apiKey);
}

/**
 * Register one or more models for a provider into Pi's ModelRegistry.
 *
 * Pi's registerProvider replaces all models when `models` is provided,
 * so when multiple agents use different models from the same provider,
 * all model IDs must be batched into a single call.
 *
 * @throws Error if the provider is not in REGISTRARS
 */
export function registerProviderWithModels(
	name: string,
	registry: ModelRegistry,
	modelIds: string[],
	apiKey: string,
): void {
	const registrar = REGISTRARS[name];
	if (!registrar) {
		throw new Error(
			`Unknown provider '${name}'. Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`,
		);
	}
	registrar({ registry, modelIds, apiKey });
}

/**
 * Check whether a provider name is supported.
 */
export function isProviderSupported(name: string): name is SupportedProvider {
	return (SUPPORTED_PROVIDERS as readonly string[]).includes(name);
}
