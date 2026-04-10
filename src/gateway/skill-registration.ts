import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import type { RoutingRule, RoutingTable } from "./routing-schema.js";
import { VERB_NAMES, type VerbName } from "./verbs.js";

export interface SkillRegistration {
	skillName: string;
	verb: VerbName;
	priority: number;
	match?: RoutingRule["match"];
}

/**
 * Scan a skills directory for SKILL.md files with mypensieve_exposes_via frontmatter.
 * Returns registrations that should be added to the verb routing tables.
 */
export function scanSkillsForRegistration(skillsDir: string): SkillRegistration[] {
	const registrations: SkillRegistration[] = [];

	if (!fs.existsSync(skillsDir)) return registrations;

	const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
		if (!fs.existsSync(skillMdPath)) continue;

		const content = fs.readFileSync(skillMdPath, "utf-8");
		const { frontmatter } = parseFrontmatter(content);

		if (!frontmatter) continue;

		const exposesVia = frontmatter.mypensieve_exposes_via;
		if (!exposesVia || typeof exposesVia !== "string") continue;

		// Validate it's a real verb name
		if (!VERB_NAMES.includes(exposesVia as VerbName)) {
			console.warn(
				`[mypensieve] Skill '${entry.name}' declares mypensieve_exposes_via: '${exposesVia}' which is not a valid verb. Skipping.`,
			);
			continue;
		}

		registrations.push({
			skillName: entry.name,
			verb: exposesVia as VerbName,
			priority:
				typeof frontmatter.mypensieve_priority === "number" ? frontmatter.mypensieve_priority : 50,
			match: frontmatter.mypensieve_match as RoutingRule["match"],
		});
	}

	return registrations;
}

/**
 * Apply skill registrations to routing tables.
 * Adds each registered skill as a routing rule under its declared verb.
 */
export function applySkillRegistrations(
	tables: Map<VerbName, RoutingTable>,
	registrations: SkillRegistration[],
): void {
	for (const reg of registrations) {
		const table = tables.get(reg.verb);
		if (!table) continue;

		// Check if this skill is already registered
		const exists = table.rules.some((r) => r.target === reg.skillName);
		if (exists) continue;

		table.rules.push({
			name: `custom:${reg.skillName}`,
			target: reg.skillName,
			target_type: "skill",
			match: reg.match,
			priority: reg.priority,
			enabled: true,
		});
	}
}
