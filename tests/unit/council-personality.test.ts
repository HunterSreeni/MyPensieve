import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock persona directory
const tmpDir = path.join(os.tmpdir(), "council-persona-test-stable");
const personaDir = path.join(tmpDir, "persona");

vi.mock("../../src/config/paths.js", () => ({
	DIRS: { persona: path.join(os.tmpdir(), "council-persona-test-stable", "persona") },
	MYPENSIEVE_DIR: path.join(os.tmpdir(), "council-persona-test-stable"),
	SECRETS_DIR: path.join(os.tmpdir(), "council-persona-test-stable", ".secrets"),
	AGENT_PERSONA_PATH: path.join(os.tmpdir(), "council-persona-test-stable", "persona", "agent.md"),
	OPERATOR_PERSONA_PATH: path.join(
		os.tmpdir(),
		"council-persona-test-stable",
		"persona",
		"operator.md",
	),
}));

import {
	clearPersonalityCache,
	loadCouncilPersonality,
} from "../../src/council/personality-loader.js";
import { DEFAULT_PERSONALITIES } from "../../src/council/personas.js";
import { PERSONA_TEMPLATE_MARKER } from "../../src/init/persona-templates.js";

describe("Council personality loader", () => {
	beforeEach(() => {
		if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
		fs.mkdirSync(personaDir, { recursive: true });
		clearPersonalityCache();
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
		clearPersonalityCache();
	});

	it("falls back to default personality when no file exists", () => {
		const personality = loadCouncilPersonality("orchestrator");
		expect(personality).toBe(DEFAULT_PERSONALITIES.orchestrator);
	});

	it("loads personality from .md file when it exists", () => {
		const customPersonality = "You are a custom orchestrator with a pirate accent.";
		fs.writeFileSync(path.join(personaDir, "orchestrator.md"), customPersonality);

		const personality = loadCouncilPersonality("orchestrator");
		expect(personality).toBe(customPersonality);
	});

	it("falls back to default when file is still a template", () => {
		const templateContent = `${PERSONA_TEMPLATE_MARKER}\n# Orchestrator\nTemplate content`;
		fs.writeFileSync(path.join(personaDir, "orchestrator.md"), templateContent);

		const personality = loadCouncilPersonality("orchestrator");
		expect(personality).toBe(DEFAULT_PERSONALITIES.orchestrator);
	});

	it("returns empty string for unknown agent name", () => {
		const personality = loadCouncilPersonality("nonexistent-agent");
		expect(personality).toBe("");
	});

	it("caches personality on first read", () => {
		const customText = "Cached personality";
		fs.writeFileSync(path.join(personaDir, "researcher.md"), customText);

		const first = loadCouncilPersonality("researcher");
		expect(first).toBe(customText);

		// Delete file - should still return cached value
		fs.unlinkSync(path.join(personaDir, "researcher.md"));
		const second = loadCouncilPersonality("researcher");
		expect(second).toBe(customText);
	});

	it("clearPersonalityCache forces reload", () => {
		fs.writeFileSync(path.join(personaDir, "critic.md"), "Version 1");
		loadCouncilPersonality("critic");

		// Update file
		fs.writeFileSync(path.join(personaDir, "critic.md"), "Version 2");

		// Still cached
		expect(loadCouncilPersonality("critic")).toBe("Version 1");

		// Clear and reload
		clearPersonalityCache();
		expect(loadCouncilPersonality("critic")).toBe("Version 2");
	});

	it("loads all 4 default agent personalities", () => {
		for (const name of ["orchestrator", "researcher", "critic", "devil-advocate"]) {
			const p = loadCouncilPersonality(name);
			expect(p.length).toBeGreaterThan(0);
			clearPersonalityCache();
		}
	});
});

describe("Council persona templates", () => {
	beforeEach(() => {
		if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
		fs.mkdirSync(personaDir, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
	});

	it("writeCouncilPersonaTemplates creates 4 files", async () => {
		const { writeCouncilPersonaTemplates } = await import("../../src/init/persona-templates.js");
		const result = writeCouncilPersonaTemplates();
		expect(result.written).toEqual(["orchestrator", "researcher", "critic", "devil-advocate"]);
		expect(result.skipped).toEqual([]);

		for (const name of result.written) {
			const filePath = path.join(personaDir, `${name}.md`);
			expect(fs.existsSync(filePath)).toBe(true);
			const content = fs.readFileSync(filePath, "utf-8");
			expect(content).toContain(PERSONA_TEMPLATE_MARKER);
			expect(content).toContain("Personality");
		}
	});

	it("skips existing files (preserves operator edits)", async () => {
		fs.writeFileSync(path.join(personaDir, "orchestrator.md"), "Custom orchestrator");

		const { writeCouncilPersonaTemplates } = await import("../../src/init/persona-templates.js");
		const result = writeCouncilPersonaTemplates();
		expect(result.written).toEqual(["researcher", "critic", "devil-advocate"]);
		expect(result.skipped).toEqual(["orchestrator"]);

		// Custom file preserved
		expect(fs.readFileSync(path.join(personaDir, "orchestrator.md"), "utf-8")).toBe(
			"Custom orchestrator",
		);
	});
});
