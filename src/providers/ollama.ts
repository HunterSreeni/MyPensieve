import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { captureError } from "../ops/index.js";

export interface OllamaTagEntry {
	name: string;
	model: string;
	remote_host?: string;
	remote_model?: string;
	size?: number;
}

export interface OllamaProbeResult {
	ok: boolean;
	host: string;
	models: OllamaTagEntry[];
	error?: string;
}

/**
 * Resolve the Ollama host URL. Honors OLLAMA_HOST env var (bare host or full URL).
 */
export function getOllamaHost(): string {
	const raw = process.env.OLLAMA_HOST?.trim();
	if (!raw) return "http://localhost:11434";
	if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/$/, "");
	return `http://${raw}`.replace(/\/$/, "");
}

/**
 * Probe the local Ollama daemon and return the list of installed models.
 * Does not throw on connection errors - returns `ok: false` instead so callers
 * can render a clean install/start prompt.
 */
export async function probeOllama(host: string = getOllamaHost()): Promise<OllamaProbeResult> {
	try {
		const res = await fetch(`${host}/api/tags`, { method: "GET" });
		if (!res.ok) {
			const error = `HTTP ${res.status} from ${host}/api/tags`;
			captureError({
				severity: "high",
				errorType: "ollama_probe_http",
				errorSrc: "providers:ollama",
				message: error,
				context: { host, status: res.status },
			});
			return { ok: false, host, models: [], error };
		}
		const body = (await res.json()) as { models?: OllamaTagEntry[] };
		return { ok: true, host, models: body.models ?? [] };
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "high",
			errorType: "ollama_probe_network",
			errorSrc: "providers:ollama",
			message: e.message,
			stack: e.stack,
			context: { host },
		});
		return {
			ok: false,
			host,
			models: [],
			error: e.message,
		};
	}
}

/**
 * Identify cloud-backed models in an Ollama model list.
 * Ollama marks cloud models with either a ':cloud' name suffix or a remote_host field.
 */
export function filterCloudModels(models: OllamaTagEntry[]): OllamaTagEntry[] {
	return models.filter((m) => m.name.endsWith(":cloud") || Boolean(m.remote_host));
}

/**
 * Identify local embedding models in an Ollama model list.
 *
 * Heuristics (conservative - prefers false-negative over false-positive so we
 * don't accidentally recommend a chat model for embeddings):
 *   - name contains "embed" (covers nomic-embed-text, mxbai-embed-large, bge-*-embed, etc.)
 *   - OR family includes "bert" (nomic-bert, bert-large, etc.)
 * Cloud-tagged models are excluded because embeddings should stay local to
 * avoid per-query API cost.
 */
export function filterEmbeddingModels(models: OllamaTagEntry[]): OllamaTagEntry[] {
	return models.filter((m) => {
		if (m.name.endsWith(":cloud") || m.remote_host) return false;
		const lowerName = m.name.toLowerCase();
		if (lowerName.includes("embed")) return true;
		return false;
	});
}

/**
 * Register the Ollama provider with Pi's ModelRegistry using the chosen models.
 *
 * The local Ollama daemon handles cloud auth transparently via `ollama signin`.
 * Ollama's OpenAI-compat endpoint requires an API key field but ignores its value,
 * so we pass the conventional placeholder `"ollama"`.
 *
 * Compat overrides are explicit because Pi's auto-detection (which runs against
 * `localhost:11434`) picks OpenAI-style defaults (`max_completion_tokens`,
 * `developer` role, `/responses` store support) that Ollama's implementation
 * does not accept.
 *
 * @param registry Pi's ModelRegistry instance
 * @param host Ollama daemon base URL (e.g. http://localhost:11434)
 * @param modelIds Ollama model ids (e.g. ["nemotron-3-super:cloud"])
 */
export function registerOllamaProvider(
	registry: ModelRegistry,
	host: string,
	modelIds: string[],
): void {
	// AI-DEV Note: This function now accepts an array of modelIds instead of a single
	// modelId to support registering multiple models for the same provider at once.
	// This prevents Pi's registerProvider from overwriting models in a loop.
	registry.registerProvider("ollama", {
		baseUrl: `${host}/v1`,
		api: "openai-completions",
		apiKey: "ollama",
		authHeader: true,
		models: modelIds.map((modelId) => ({
			id: modelId,
			name: modelId,
			api: "openai-completions",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 32_000,
			compat: {
				supportsStore: false,
				supportsDeveloperRole: false,
				maxTokensField: "max_tokens",
			},
		})),
	});
}

/**
 * Render a user-facing error message with install/signin steps.
 * Used when the daemon probe fails or no cloud models are signed in.
 */
export function renderOllamaSetupHelp(
	reason: "not-running" | "no-cloud-models",
	host: string,
): string {
	if (reason === "not-running") {
		return [
			`  Ollama daemon is not reachable at ${host}.`,
			"",
			"  Install & start:",
			"    1. Install Ollama from https://ollama.com/download",
			"    2. Start the daemon (it auto-starts on macOS/Windows; on Linux:",
			"       run `ollama serve` or enable the systemd service)",
			"    3. Sign in to enable cloud models: `ollama signin`",
			"    4. Pull at least one cloud model:",
			"       `ollama pull gpt-oss:20b-cloud` (or any *-cloud model)",
			"    5. Re-run `mypensieve init --restart`",
		].join("\n");
	}
	return [
		"  Ollama is running but no cloud models are available.",
		"",
		"  To enable cloud models:",
		"    1. Run `ollama signin` (in another terminal) and sign in at the",
		"       link it prints",
		"    2. Pull a cloud model, e.g. `ollama pull gpt-oss:20b-cloud`",
		"    3. Re-run `mypensieve init --restart`",
	].join("\n");
}
