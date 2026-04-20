import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anthropicComplete } from "../../src/providers/anthropic-complete.js";
import {
	UnsupportedExtractorProviderError,
	buildCompleteFn,
} from "../../src/providers/complete-factory.js";
import { openaiComplete } from "../../src/providers/openai-complete.js";
import { openrouterComplete } from "../../src/providers/openrouter-complete.js";

const originalFetch = globalThis.fetch;

type FakeFetch = ReturnType<typeof vi.fn>;

function installFakeFetch(responder: (url: string, init: RequestInit) => Response): FakeFetch {
	const fake = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
		responder(String(url), init ?? {}),
	) as unknown as FakeFetch;
	globalThis.fetch = fake as unknown as typeof fetch;
	return fake;
}

beforeEach(() => {
	globalThis.fetch = originalFetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("anthropicComplete", () => {
	it("sends x-api-key header and reads content[0].text", async () => {
		const fake = installFakeFetch((url, init) => {
			expect(url).toBe("https://api.anthropic.com/v1/messages");
			expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k-anthropic");
			expect((init.headers as Record<string, string>)["anthropic-version"]).toBeTruthy();
			const body = JSON.parse(String(init.body));
			expect(body.model).toBe("claude-sonnet-4-6");
			expect(body.messages[0].content).toBe("prompt text");
			expect(body.system).toContain("JSON");
			return new Response(JSON.stringify({ content: [{ type: "text", text: '{"ok":true}' }] }), {
				status: 200,
			});
		});
		const r = await anthropicComplete({
			apiKey: "k-anthropic",
			model: "claude-sonnet-4-6",
			system: "base system",
			prompt: "prompt text",
			json: true,
		});
		expect(fake).toHaveBeenCalledOnce();
		expect(r.ok).toBe(true);
		expect(r.text).toBe('{"ok":true}');
	});

	it("returns non-ok on HTTP error", async () => {
		installFakeFetch(() => new Response("forbidden", { status: 403 }));
		const r = await anthropicComplete({
			apiKey: "bad",
			model: "claude-sonnet-4-6",
			prompt: "hi",
		});
		expect(r.ok).toBe(false);
		expect(r.error).toContain("403");
	});
});

describe("openaiComplete", () => {
	it("sends Bearer auth and reads choices[0].message.content", async () => {
		installFakeFetch((url, init) => {
			expect(url).toBe("https://api.openai.com/v1/chat/completions");
			expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k-openai");
			const body = JSON.parse(String(init.body));
			expect(body.model).toBe("gpt-4o");
			expect(body.response_format).toEqual({ type: "json_object" });
			return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }), {
				status: 200,
			});
		});
		const r = await openaiComplete({
			apiKey: "k-openai",
			model: "gpt-4o",
			prompt: "hi",
			json: true,
		});
		expect(r.ok).toBe(true);
		expect(r.text).toBe('{"a":1}');
	});
});

describe("openrouterComplete", () => {
	it("uses the OpenRouter base URL", async () => {
		installFakeFetch((url) => {
			expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
			return new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] }), {
				status: 200,
			});
		});
		const r = await openrouterComplete({
			apiKey: "k-or",
			model: "anthropic/claude-3.5-sonnet",
			prompt: "hi",
		});
		expect(r.ok).toBe(true);
		expect(r.text).toBe("x");
	});
});

describe("buildCompleteFn", () => {
	it("throws for unknown providers", () => {
		expect(() => buildCompleteFn("made-up-provider")).toThrow(UnsupportedExtractorProviderError);
	});

	it("returns an ollama-routed fn for ollama", async () => {
		installFakeFetch((url) => {
			expect(url).toContain("/api/chat");
			return new Response(JSON.stringify({ message: { content: "ollama-text" } }), {
				status: 200,
			});
		});
		const fn = buildCompleteFn("ollama");
		const r = await fn({ model: "llama3", system: "s", prompt: "p" });
		expect(r.ok).toBe(true);
		expect(r.text).toBe("ollama-text");
	});
});
