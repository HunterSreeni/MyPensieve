import { captureError } from "../ops/index.js";
import { MAX_COMPLETION_BYTES } from "./ollama-complete.js";

export interface AnthropicCompleteOptions {
	apiKey: string;
	model: string;
	system?: string;
	prompt: string;
	/** Request JSON-shaped output by appending a strict instruction to the system prompt. */
	json?: boolean;
	timeoutMs?: number;
	maxTokens?: number;
}

export interface AnthropicCompleteResult {
	ok: boolean;
	text: string;
	error?: string;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * One-shot, non-streaming completion via Anthropic Messages API.
 * Mirrors the ollamaComplete contract so the extractor's CompleteFn abstraction
 * can drop this in as a provider-specific shim.
 */
export async function anthropicComplete(
	opts: AnthropicCompleteOptions,
): Promise<AnthropicCompleteResult> {
	const system = opts.json
		? `${opts.system ?? ""}\n\nYou MUST respond with a single valid JSON object. Do not wrap it in markdown fences. Do not add commentary.`.trim()
		: opts.system;

	const body: Record<string, unknown> = {
		model: opts.model,
		max_tokens: opts.maxTokens ?? 4096,
		messages: [{ role: "user", content: opts.prompt }],
	};
	if (system) body.system = system;

	const ctrl = new AbortController();
	const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);

	try {
		const res = await fetch(ANTHROPIC_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": opts.apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
			},
			body: JSON.stringify(body),
			signal: ctrl.signal,
		});
		if (!res.ok) {
			const error = `HTTP ${res.status} from ${ANTHROPIC_URL}`;
			captureError({
				severity: "high",
				errorType: "anthropic_complete_http",
				errorSrc: "providers:anthropic-complete",
				message: error,
				context: { model: opts.model, status: res.status },
			});
			return { ok: false, text: "", error };
		}
		const json = (await res.json()) as {
			content?: Array<{ type: string; text?: string }>;
		};
		const raw = json.content?.find((c) => c.type === "text")?.text ?? "";
		const text = raw.length > MAX_COMPLETION_BYTES ? raw.slice(0, MAX_COMPLETION_BYTES) : raw;
		return { ok: true, text };
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "high",
			errorType: "anthropic_complete_network",
			errorSrc: "providers:anthropic-complete",
			message: e.message,
			stack: e.stack,
			context: { model: opts.model },
		});
		return { ok: false, text: "", error: e.message };
	} finally {
		clearTimeout(timeout);
	}
}
