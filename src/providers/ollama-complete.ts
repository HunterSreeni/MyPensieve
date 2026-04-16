import { captureError } from "../ops/index.js";
import { getOllamaHost } from "./ollama.js";

export interface OllamaCompleteOptions {
	host?: string;
	model: string;
	system?: string;
	prompt: string;
	/** When true, requests JSON-formatted output (Ollama native). */
	json?: boolean;
	/** Request timeout in ms. Default 120s. */
	timeoutMs?: number;
}

export interface OllamaCompleteResult {
	ok: boolean;
	text: string;
	error?: string;
}

/**
 * Hard cap on the text we return from a one-shot completion. Guards against a
 * rogue / misconfigured model streaming megabytes of output into JSON.parse
 * downstream. 256KB is well above any structured extraction response.
 */
export const MAX_COMPLETION_BYTES = 256 * 1024;

/**
 * One-shot, non-streaming completion via Ollama's native /api/chat endpoint.
 * Used by the memory extractor (and any other batch job that needs a simple
 * synchronous completion outside of Pi's session/registry plumbing).
 */
export async function ollamaComplete(opts: OllamaCompleteOptions): Promise<OllamaCompleteResult> {
	const host = opts.host ?? getOllamaHost();
	const url = `${host}/api/chat`;
	const messages: Array<{ role: string; content: string }> = [];
	if (opts.system) messages.push({ role: "system", content: opts.system });
	messages.push({ role: "user", content: opts.prompt });

	const body: Record<string, unknown> = {
		model: opts.model,
		messages,
		stream: false,
	};
	if (opts.json) body.format = "json";

	const ctrl = new AbortController();
	const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);

	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: ctrl.signal,
		});
		if (!res.ok) {
			const error = `HTTP ${res.status} from ${url}`;
			captureError({
				severity: "high",
				errorType: "ollama_complete_http",
				errorSrc: "providers:ollama-complete",
				message: error,
				context: { host, model: opts.model, status: res.status },
			});
			return { ok: false, text: "", error };
		}
		const json = (await res.json()) as { message?: { content?: string } };
		const raw = json.message?.content ?? "";
		const text = raw.length > MAX_COMPLETION_BYTES ? raw.slice(0, MAX_COMPLETION_BYTES) : raw;
		return { ok: true, text };
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "high",
			errorType: "ollama_complete_network",
			errorSrc: "providers:ollama-complete",
			message: e.message,
			stack: e.stack,
			context: { host, model: opts.model },
		});
		return { ok: false, text: "", error: e.message };
	} finally {
		clearTimeout(timeout);
	}
}
