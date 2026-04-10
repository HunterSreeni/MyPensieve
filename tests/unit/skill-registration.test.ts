import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ROUTING_TABLES } from "../../src/gateway/routing-loader.js";
import type { RoutingTable } from "../../src/gateway/routing-schema.js";
import {
	applySkillRegistrations,
	scanSkillsForRegistration,
} from "../../src/gateway/skill-registration.js";
import type { VerbName } from "../../src/gateway/verbs.js";
import { VERB_NAMES } from "../../src/gateway/verbs.js";

describe("Skill registration", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-skills-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function createSkillDir(name: string, frontmatter: string, body = "Skill body"): void {
		const skillDir = path.join(tmpDir, name);
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`, "utf-8");
	}

	it("finds skills with mypensieve_exposes_via", () => {
		createSkillDir("my-skill", "name: my-skill\nmypensieve_exposes_via: recall");
		const registrations = scanSkillsForRegistration(tmpDir);
		expect(registrations).toHaveLength(1);
		expect(registrations[0]?.skillName).toBe("my-skill");
		expect(registrations[0]?.verb).toBe("recall");
	});

	it("skips skills without mypensieve_exposes_via", () => {
		createSkillDir("plain-skill", "name: plain-skill\ndescription: no verb");
		const registrations = scanSkillsForRegistration(tmpDir);
		expect(registrations).toHaveLength(0);
	});

	it("skips invalid verb names", () => {
		createSkillDir("bad-skill", "name: bad-skill\nmypensieve_exposes_via: invalid_verb");
		const registrations = scanSkillsForRegistration(tmpDir);
		expect(registrations).toHaveLength(0);
	});

	it("picks up custom priority", () => {
		createSkillDir(
			"priority-skill",
			"name: p\nmypensieve_exposes_via: produce\nmypensieve_priority: 5",
		);
		const registrations = scanSkillsForRegistration(tmpDir);
		expect(registrations[0]?.priority).toBe(5);
	});

	it("defaults priority to 50", () => {
		createSkillDir("default-priority", "name: d\nmypensieve_exposes_via: recall");
		const registrations = scanSkillsForRegistration(tmpDir);
		expect(registrations[0]?.priority).toBe(50);
	});

	it("returns empty for nonexistent directory", () => {
		const registrations = scanSkillsForRegistration("/nonexistent/skills");
		expect(registrations).toHaveLength(0);
	});

	it("scans multiple skills", () => {
		createSkillDir("skill-a", "name: a\nmypensieve_exposes_via: recall");
		createSkillDir("skill-b", "name: b\nmypensieve_exposes_via: produce");
		createSkillDir("skill-c", "name: c\nmypensieve_exposes_via: research");
		const registrations = scanSkillsForRegistration(tmpDir);
		expect(registrations).toHaveLength(3);
	});
});

describe("applySkillRegistrations", () => {
	function makeTables(): Map<VerbName, RoutingTable> {
		const tables = new Map<VerbName, RoutingTable>();
		for (const verb of VERB_NAMES) {
			tables.set(verb, {
				...DEFAULT_ROUTING_TABLES[verb],
				rules: [...DEFAULT_ROUTING_TABLES[verb].rules],
			});
		}
		return tables;
	}

	it("adds a registration as a routing rule", () => {
		const tables = makeTables();
		const initialRuleCount = tables.get("recall")?.rules.length ?? 0;

		applySkillRegistrations(tables, [{ skillName: "custom-recall", verb: "recall", priority: 25 }]);

		const recallTable = tables.get("recall");
		expect(recallTable?.rules.length).toBe(initialRuleCount + 1);
		expect(recallTable?.rules.find((r) => r.target === "custom-recall")).toBeDefined();
	});

	it("does not add duplicates", () => {
		const tables = makeTables();
		const reg = { skillName: "custom-recall", verb: "recall" as VerbName, priority: 25 };

		applySkillRegistrations(tables, [reg]);
		applySkillRegistrations(tables, [reg]); // second time

		const matches = tables.get("recall")?.rules.filter((r) => r.target === "custom-recall");
		expect(matches?.length).toBe(1);
	});

	it("respects custom priority in the added rule", () => {
		const tables = makeTables();
		applySkillRegistrations(tables, [{ skillName: "high-priority", verb: "produce", priority: 1 }]);

		const rule = tables.get("produce")?.rules.find((r) => r.target === "high-priority");
		expect(rule?.priority).toBe(1);
	});
});
