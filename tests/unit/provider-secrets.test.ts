import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted - cannot reference outer variables directly.
// Use a stable path that we create in beforeEach.
const tmpDir = path.join(os.tmpdir(), "secrets-test-stable");
const secretsDir = path.join(tmpDir, ".secrets");

vi.mock("../../src/config/paths.js", () => ({
	SECRETS_DIR: path.join(os.tmpdir(), "secrets-test-stable", ".secrets"),
}));

import { hasProviderApiKey, readProviderApiKey } from "../../src/providers/secrets.js";

describe("Provider secrets", () => {
	beforeEach(() => {
		if (fs.existsSync(secretsDir)) {
			fs.rmSync(secretsDir, { recursive: true });
		}
		fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true });
		}
	});

	describe("readProviderApiKey", () => {
		it("reads a valid api_key from {provider}.json", () => {
			const secretPath = path.join(secretsDir, "anthropic.json");
			fs.writeFileSync(secretPath, JSON.stringify({ api_key: "sk-ant-test123" }));
			fs.chmodSync(secretPath, 0o600);

			const key = readProviderApiKey("anthropic");
			expect(key).toBe("sk-ant-test123");
		});

		it("throws if file does not exist", () => {
			expect(() => readProviderApiKey("openai")).toThrow("API key not found");
			expect(() => readProviderApiKey("openai")).toThrow("openai");
		});

		it("throws if api_key field is missing", () => {
			const secretPath = path.join(secretsDir, "openrouter.json");
			fs.writeFileSync(secretPath, JSON.stringify({ token: "wrong-field" }));
			fs.chmodSync(secretPath, 0o600);

			expect(() => readProviderApiKey("openrouter")).toThrow("missing or empty 'api_key'");
		});

		it("throws if api_key is empty string", () => {
			const secretPath = path.join(secretsDir, "anthropic.json");
			fs.writeFileSync(secretPath, JSON.stringify({ api_key: "" }));
			fs.chmodSync(secretPath, 0o600);

			expect(() => readProviderApiKey("anthropic")).toThrow("missing or empty 'api_key'");
		});

		it("warns on wrong file permissions (non-0600)", () => {
			const secretPath = path.join(secretsDir, "anthropic.json");
			fs.writeFileSync(secretPath, JSON.stringify({ api_key: "sk-test" }));
			fs.chmodSync(secretPath, 0o644);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			readProviderApiKey("anthropic");
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("mode 644"));
			warnSpy.mockRestore();
		});

		it("warns on wrong directory permissions (non-0700)", () => {
			fs.chmodSync(secretsDir, 0o755);
			const secretPath = path.join(secretsDir, "anthropic.json");
			fs.writeFileSync(secretPath, JSON.stringify({ api_key: "sk-test" }));
			fs.chmodSync(secretPath, 0o600);

			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			readProviderApiKey("anthropic");
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("mode 755"));
			warnSpy.mockRestore();
			// Restore dir permissions for cleanup
			fs.chmodSync(secretsDir, 0o700);
		});
	});

	describe("hasProviderApiKey", () => {
		it("returns true if file exists", () => {
			const secretPath = path.join(secretsDir, "anthropic.json");
			fs.writeFileSync(secretPath, JSON.stringify({ api_key: "test" }));
			expect(hasProviderApiKey("anthropic")).toBe(true);
		});

		it("returns false if file does not exist", () => {
			expect(hasProviderApiKey("openai")).toBe(false);
		});
	});
});
