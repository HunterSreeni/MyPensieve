import { openaiComplete } from "./openai-complete.js";

export interface OpenRouterCompleteOptions {
	apiKey: string;
	model: string;
	system?: string;
	prompt: string;
	json?: boolean;
	timeoutMs?: number;
}

/**
 * OpenRouter uses the OpenAI Chat Completions wire format with a different
 * base URL. Reuse the OpenAI shim with a baseUrl override.
 */
export async function openrouterComplete(opts: OpenRouterCompleteOptions) {
	return openaiComplete({
		apiKey: opts.apiKey,
		model: opts.model,
		system: opts.system,
		prompt: opts.prompt,
		json: opts.json,
		timeoutMs: opts.timeoutMs,
		baseUrl: "https://openrouter.ai/api/v1",
	});
}
