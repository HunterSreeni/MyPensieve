/**
 * Multi-provider registration.
 *
 * Collects all unique provider/model pairs from config (default_model +
 * agent_models), groups models by provider, and registers each provider
 * once with all its models batched together.
 *
 * Pi's registerProvider replaces all models when `models` is provided,
 * so batching is required to avoid overwriting models from the same provider.
 */
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Config } from "../config/schema.js";
import { parseModelString } from "../config/schema.js";
import { isProviderSupported, registerProviderWithModels } from "./factory.js";
import { readProviderApiKey } from "./secrets.js";

export interface RegistrationPlan {
	/** Provider name -> list of model IDs to register */
	providers: Record<string, string[]>;
	/** Provider name -> API key (empty for Ollama) */
	apiKeys: Record<string, string>;
	/** Warnings (e.g. unsupported provider, missing API key) */
	warnings: string[];
}

/**
 * Build a registration plan from config. Does not perform registration -
 * just collects what needs to be registered and resolves API keys.
 */
export function buildRegistrationPlan(config: Config): RegistrationPlan {
	const providers: Record<string, string[]> = {};
	const apiKeys: Record<string, string> = {};
	const warnings: string[] = [];

	// Collect all model strings: default + per-agent overrides
	const modelStrings: string[] = [];
	if (config.default_model) modelStrings.push(config.default_model);
	if (config.agent_models) {
		for (const model of Object.values(config.agent_models)) {
			if (model) modelStrings.push(model);
		}
	}

	// Deduplicate and group by provider
	const seen = new Set<string>();
	for (const ms of modelStrings) {
		if (seen.has(ms)) continue;
		seen.add(ms);

		try {
			const { provider, modelId } = parseModelString(ms);

			if (!isProviderSupported(provider)) {
				warnings.push(`Unsupported provider '${provider}' in model '${ms}' - skipping`);
				continue;
			}

			if (!providers[provider]) providers[provider] = [];
			if (!providers[provider].includes(modelId)) {
				providers[provider].push(modelId);
			}
		} catch {
			warnings.push(`Invalid model string '${ms}' - skipping`);
		}
	}

	// Resolve API keys for each provider
	for (const provider of Object.keys(providers)) {
		if (provider === "ollama") {
			apiKeys[provider] = "";
			continue;
		}
		try {
			apiKeys[provider] = readProviderApiKey(provider);
		} catch (err) {
			const e = err instanceof Error ? err : new Error(String(err));
			warnings.push(`API key missing for '${provider}': ${e.message}`);
		}
	}

	return { providers, apiKeys, warnings };
}

/**
 * Register all providers from a registration plan into Pi's ModelRegistry.
 * Skips providers with missing API keys (logged as warnings in the plan).
 */
export function executeRegistrationPlan(plan: RegistrationPlan, registry: ModelRegistry): void {
	for (const [provider, modelIds] of Object.entries(plan.providers)) {
		const apiKey = plan.apiKeys[provider];
		if (apiKey === undefined) continue; // Missing key - skip
		registerProviderWithModels(provider, registry, modelIds, apiKey);
	}
}
