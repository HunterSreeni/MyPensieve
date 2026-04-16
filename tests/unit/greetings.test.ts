import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), "greetings-test-stable");
const personaDir = path.join(tmpDir, "persona");

vi.mock("../../src/config/paths.js", () => ({
	DIRS: { persona: path.join(os.tmpdir(), "greetings-test-stable", "persona") },
	MYPENSIEVE_DIR: path.join(os.tmpdir(), "greetings-test-stable"),
	SECRETS_DIR: path.join(os.tmpdir(), "greetings-test-stable", ".secrets"),
	AGENT_PERSONA_PATH: path.join(os.tmpdir(), "greetings-test-stable", "persona", "agent.md"),
	OPERATOR_PERSONA_PATH: path.join(os.tmpdir(), "greetings-test-stable", "persona", "operator.md"),
}));

import { loadGreetings, pickGreeting } from "../../src/core/greetings.js";

describe("Greetings", () => {
	beforeEach(() => {
		if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
		fs.mkdirSync(personaDir, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
	});

	describe("loadGreetings", () => {
		it("returns empty object when file does not exist", () => {
			expect(loadGreetings()).toEqual({});
		});

		it("loads greetings from valid JSON file", () => {
			const greetings = { formal: ["Hello."], casual: ["Hey!"] };
			fs.writeFileSync(path.join(personaDir, "greetings.json"), JSON.stringify(greetings));
			expect(loadGreetings()).toEqual(greetings);
		});

		it("returns empty object for invalid JSON", () => {
			fs.writeFileSync(path.join(personaDir, "greetings.json"), "not json");
			expect(loadGreetings()).toEqual({});
		});
	});

	describe("pickGreeting", () => {
		it("returns null when no greetings file exists", () => {
			expect(pickGreeting("formal")).toBeNull();
		});

		it("returns null for unknown personality", () => {
			const greetings = { formal: ["Hello."] };
			fs.writeFileSync(path.join(personaDir, "greetings.json"), JSON.stringify(greetings));
			expect(pickGreeting("unknown")).toBeNull();
		});

		it("returns null for empty array", () => {
			const greetings = { formal: [] };
			fs.writeFileSync(path.join(personaDir, "greetings.json"), JSON.stringify(greetings));
			expect(pickGreeting("formal")).toBeNull();
		});

		it("picks a greeting from the pool", () => {
			const greetings = { casual: ["Hey!", "Yo!", "Sup!"] };
			fs.writeFileSync(path.join(personaDir, "greetings.json"), JSON.stringify(greetings));
			const greeting = pickGreeting("casual");
			expect(greeting).not.toBeNull();
			expect(greetings.casual).toContain(greeting);
		});

		it("replaces {name} with agent name", () => {
			const greetings = { formal: ["{name} at your service."] };
			fs.writeFileSync(path.join(personaDir, "greetings.json"), JSON.stringify(greetings));
			const greeting = pickGreeting("formal", "Dobby");
			expect(greeting).toBe("Dobby at your service.");
		});

		it("replaces multiple {name} occurrences", () => {
			const greetings = { formal: ["{name} here. Yes, {name}."] };
			fs.writeFileSync(path.join(personaDir, "greetings.json"), JSON.stringify(greetings));
			const greeting = pickGreeting("formal", "Nova");
			expect(greeting).toBe("Nova here. Yes, Nova.");
		});
	});

	describe("writeGreetingsTemplate", () => {
		it("creates greetings.json with 4 personality styles", async () => {
			const { writeGreetingsTemplate } = await import("../../src/init/persona-templates.js");
			const result = writeGreetingsTemplate();
			expect(result.written).toBe(true);

			const content = JSON.parse(fs.readFileSync(result.path, "utf-8"));
			expect(Object.keys(content)).toEqual(["formal", "casual", "snarky", "witty"]);
			for (const pool of Object.values(content) as string[][]) {
				expect(pool.length).toBeGreaterThan(0);
			}
		});

		it("does not overwrite existing file", async () => {
			fs.writeFileSync(path.join(personaDir, "greetings.json"), '{"custom": ["hi"]}');

			const { writeGreetingsTemplate } = await import("../../src/init/persona-templates.js");
			const result = writeGreetingsTemplate();
			expect(result.written).toBe(false);

			const content = JSON.parse(fs.readFileSync(result.path, "utf-8"));
			expect(content).toEqual({ custom: ["hi"] });
		});
	});
});
