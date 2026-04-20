/**
 * Provider-aware CompleteFn factory for the memory extractor.
 *
 * The extractor needs a uniform one-shot completion interface. Different
 * providers have different wire formats (Anthropic messages, OpenAI chat,
 * Ollama's native chat endpoint). This factory returns a CompleteFn that
 * dispatches to the correct shim and handles API key lookup.
 */
import type { CompleteFn } from "../memory/extractor.js";
import { anthropicComplete } from "./anthropic-complete.js";
import { ollamaComplete } from "./ollama-complete.js";
import { openaiComplete } from "./openai-complete.js";
import { openrouterComplete } from "./openrouter-complete.js";
import { readProviderApiKey } from "./secrets.js";

export class UnsupportedExtractorProviderError extends Error {
	constructor(public readonly provider: string) {
		super(
			`Provider '${provider}' is not wired into the extractor. Supported: ollama, anthropic, openai, openrouter.`,
		);
		this.name = "UnsupportedExtractorProviderError";
	}
}

/**
 * Return a CompleteFn bound to the given provider. API keys for non-ollama
 * providers are resolved ONCE here (fail-fast if missing) and captured in the
 * returned closure, so a missing key surfaces a single error rather than N
 * per-session failures during an extraction run.
 */
export function buildCompleteFn(provider: string): CompleteFn {
	switch (provider) {
		case "ollama":
			return async (a) => {
				const r = await ollamaComplete({
					model: a.model,
					system: a.system,
					prompt: a.prompt,
					json: true,
				});
				return { ok: r.ok, text: r.text, error: r.error };
			};
		case "anthropic": {
			const key = readProviderApiKey("anthropic");
			return async (a) => {
				const r = await anthropicComplete({
					apiKey: key,
					model: a.model,
					system: a.system,
					prompt: a.prompt,
					json: true,
				});
				return { ok: r.ok, text: r.text, error: r.error };
			};
		}
		case "openai": {
			const key = readProviderApiKey("openai");
			return async (a) => {
				const r = await openaiComplete({
					apiKey: key,
					model: a.model,
					system: a.system,
					prompt: a.prompt,
					json: true,
				});
				return { ok: r.ok, text: r.text, error: r.error };
			};
		}
		case "openrouter": {
			const key = readProviderApiKey("openrouter");
			return async (a) => {
				const r = await openrouterComplete({
					apiKey: key,
					model: a.model,
					system: a.system,
					prompt: a.prompt,
					json: true,
				});
				return { ok: r.ok, text: r.text, error: r.error };
			};
		}
		default:
			throw new UnsupportedExtractorProviderError(provider);
	}
}
