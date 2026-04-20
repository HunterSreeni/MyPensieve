import { describe, expect, it } from "vitest";
import {
	normalizeDecisionContent,
	synthesizeDecisions,
	synthesizePersonaDeltas,
} from "../../src/memory/synthesizer.js";
import type { Decision, PersonaDelta } from "../../src/memory/types.js";

function decision(id: string, content: string, timestamp: string, tags: string[] = []): Decision {
	return {
		id,
		timestamp,
		session_id: "s1",
		project: "test",
		content,
		confidence: 0.65,
		source: "auto",
		tags,
	};
}

function delta(
	id: string,
	field: string,
	content: string,
	timestamp: string,
	applied = false,
): PersonaDelta {
	return {
		id,
		timestamp,
		session_id: "s1",
		field,
		delta_type: "add",
		content,
		confidence: 0.7,
		applied,
	};
}

describe("normalizeDecisionContent", () => {
	it("lowercases and trims whitespace", () => {
		expect(normalizeDecisionContent("  Use Vite  ")).toBe("use vite");
	});
	it("collapses inner whitespace", () => {
		expect(normalizeDecisionContent("Use   Vite\n\nfor speed")).toBe("use vite for speed");
	});
	it("strips trailing punctuation", () => {
		expect(normalizeDecisionContent("Ship it!")).toBe("ship it");
	});
});

describe("synthesizeDecisions", () => {
	it("keeps the newest duplicate and merges tags", () => {
		const items = [
			decision("d1", "Use vite for bundling", "2026-04-01T00:00:00Z", ["tooling"]),
			decision("d2", "Use Vite for bundling.", "2026-04-10T00:00:00Z", ["build"]),
			decision("d3", "use   vite   for bundling", "2026-04-05T00:00:00Z", []),
		];
		const result = synthesizeDecisions(items);
		expect(result.canonical).toHaveLength(1);
		expect(result.canonical[0]?.id).toBe("d2");
		expect(result.canonical[0]?.tags.sort()).toEqual(["build", "tooling"]);
		expect(result.duplicates).toHaveLength(1);
		expect(result.duplicates[0]?.keeper_id).toBe("d2");
		expect(result.duplicates[0]?.duplicate_ids.sort()).toEqual(["d1", "d3"]);
	});

	it("preserves distinct decisions", () => {
		const items = [
			decision("d1", "Use Vite", "2026-04-01T00:00:00Z"),
			decision("d2", "Use Postgres", "2026-04-02T00:00:00Z"),
		];
		const result = synthesizeDecisions(items);
		expect(result.canonical).toHaveLength(2);
		expect(result.duplicates).toEqual([]);
	});

	it("ignores empty content", () => {
		const items = [decision("d1", "", "2026-04-01T00:00:00Z")];
		const result = synthesizeDecisions(items);
		expect(result.canonical).toEqual([]);
	});

	it("canonical output is newest-first", () => {
		const items = [
			decision("a", "First", "2026-04-01T00:00:00Z"),
			decision("b", "Second", "2026-04-05T00:00:00Z"),
			decision("c", "Third", "2026-04-03T00:00:00Z"),
		];
		const result = synthesizeDecisions(items);
		expect(result.canonical.map((c) => c.id)).toEqual(["b", "c", "a"]);
	});
});

describe("synthesizePersonaDeltas", () => {
	it("groups pending deltas by field, newest-first", () => {
		const deltas = [
			delta("p1", "communication_style", "Prefers concise answers", "2026-04-01T00:00:00Z"),
			delta("p2", "communication_style", "Direct and terse", "2026-04-03T00:00:00Z"),
			delta("p3", "tools", "Uses Neovim", "2026-04-02T00:00:00Z"),
		];
		const result = synthesizePersonaDeltas(deltas);
		expect(result.by_field.communication_style).toEqual([
			"Direct and terse",
			"Prefers concise answers",
		]);
		expect(result.by_field.tools).toEqual(["Uses Neovim"]);
		expect(result.applied_ids.sort()).toEqual(["p1", "p2", "p3"]);
	});

	it("skips already-applied deltas", () => {
		const deltas = [
			delta("p1", "tools", "already", "2026-04-01T00:00:00Z", true),
			delta("p2", "tools", "fresh", "2026-04-02T00:00:00Z", false),
		];
		const result = synthesizePersonaDeltas(deltas);
		expect(result.applied_ids).toEqual(["p2"]);
		expect(result.by_field.tools).toEqual(["fresh"]);
	});

	it("returns empty when nothing pending", () => {
		const result = synthesizePersonaDeltas([]);
		expect(result.applied_ids).toEqual([]);
		expect(result.by_field).toEqual({});
	});
});
