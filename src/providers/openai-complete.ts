import { captureError } from "../ops/index.js";
import { MAX_COMPLETION_BYTES } from "./ollama-complete.js";

export interface OpenAICompleteOptions {
	apiKey: string;
	model: string;
	system?: string;
	prompt: string;
	json?: boolean;
	timeoutMs?: number;
	baseUrl?: string;
}

export interface OpenAICompleteResult {
	ok: boolean;
	text: string;
	error?: string;
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * One-shot, non-streaming completion via the OpenAI Chat Completions API.
 * Also used as the base implementation for OpenRouter via baseUrl override.
 */
export async function openaiComplete(opts: OpenAICompleteOptions): Promise<OpenAICompleteResult> {
	const base = opts.baseUrl ?? OPENAI_BASE_URL;
	const url = `${base}/chat/completions`;
	const messages: Array<{ role: string; content: string }> = [];
	if (opts.system) messages.push({ role: "system", content: opts.system });
	messages.push({ role: "user", content: opts.prompt });

	const body: Record<string, unknown> = {
		model: opts.model,
		messages,
		stream: false,
	};
	if (opts.json) body.response_format = { type: "json_object" };

	const ctrl = new AbortController();
	const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);

	try {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${opts.apiKey}`,
			},
			body: JSON.stringify(body),
			signal: ctrl.signal,
		});
		if (!res.ok) {
			const error = `HTTP ${res.status} from ${url}`;
			captureError({
				severity: "high",
				errorType: "openai_complete_http",
				errorSrc: "providers:openai-complete",
				message: error,
				context: { url, model: opts.model, status: res.status },
			});
			return { ok: false, text: "", error };
		}
		const json = (await res.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const raw = json.choices?.[0]?.message?.content ?? "";
		const text = raw.length > MAX_COMPLETION_BYTES ? raw.slice(0, MAX_COMPLETION_BYTES) : raw;
		return { ok: true, text };
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "high",
			errorType: "openai_complete_network",
			errorSrc: "providers:openai-complete",
			message: e.message,
			stack: e.stack,
			context: { url, model: opts.model },
		});
		return { ok: false, text: "", error: e.message };
	} finally {
		clearTimeout(timeout);
	}
}
