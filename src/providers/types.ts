import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

/**
 * Options passed to a provider registration function.
 * Ollama ignores apiKey (uses host-based auth via `ollama signin`).
 * All other providers require a real API key from .secrets/.
 */
export interface ProviderRegistrationOptions {
	registry: ModelRegistry;
	modelIds: string[];
	apiKey: string;
}

/**
 * A function that registers one or more models for a specific provider
 * into Pi's ModelRegistry.
 */
export type RegisterProviderFn = (opts: ProviderRegistrationOptions) => void;
