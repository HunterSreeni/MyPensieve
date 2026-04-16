import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { DIRS } from "../config/paths.js";
import { type RoutingTable, RoutingTableSchema } from "./routing-schema.js";
import type { VerbName } from "./verbs.js";
import { VERB_NAMES } from "./verbs.js";

export class RoutingLoadError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "RoutingLoadError";
	}
}

/**
 * Default routing tables for each verb.
 * Used when no YAML file exists for a verb.
 * These map verbs to their primary skill/MCP targets.
 */
export const DEFAULT_ROUTING_TABLES: Record<VerbName, RoutingTable> = {
	recall: {
		verb: "recall",
		default_target: "memory-recall",
		default_target_type: "skill",
		rules: [],
	},
	research: {
		verb: "research",
		default_target: "researcher",
		default_target_type: "skill",
		rules: [],
	},
	ingest: {
		verb: "ingest",
		default_target: "pdf",
		default_target_type: "skill",
		rules: [
			{
				name: "audio-ingest",
				target: "audio-edit",
				target_type: "skill",
				match: { field: "source_type", value: "audio" },
				priority: 10,
				enabled: true,
			},
			{
				name: "video-ingest",
				target: "video-edit",
				target_type: "skill",
				match: { field: "source_type", value: "video" },
				priority: 10,
				enabled: true,
			},
			{
				name: "image-ingest",
				target: "image-edit",
				target_type: "skill",
				match: { field: "source_type", value: "image" },
				priority: 10,
				enabled: true,
			},
			{
				name: "interactive-web",
				target: "playwright-cli",
				target_type: "skill",
				match: { field: "interactive", value: "true" },
				priority: 20,
				enabled: true,
			},
		],
	},
	monitor: {
		verb: "monitor",
		default_target: "cve-monitor",
		default_target_type: "skill",
		rules: [
			{
				name: "cve-packages",
				target: "cve-monitor",
				target_type: "skill",
				match: { field: "target", value: ["cves", "packages"] },
				priority: 10,
				enabled: true,
			},
			{
				name: "github-monitor",
				target: "gh-cli",
				target_type: "mcp",
				match: { field: "target", value: "github" },
				priority: 10,
				enabled: true,
			},
		],
	},
	journal: {
		verb: "journal",
		default_target: "daily-log",
		default_target_type: "skill",
		rules: [],
	},
	produce: {
		verb: "produce",
		default_target: "blog-seo",
		default_target_type: "skill",
		rules: [
			{
				name: "image-produce",
				target: "image-edit",
				target_type: "skill",
				match: { field: "kind", value: "image" },
				priority: 10,
				enabled: true,
			},
			{
				name: "video-produce",
				target: "video-edit",
				target_type: "skill",
				match: { field: "kind", value: "video" },
				priority: 10,
				enabled: true,
			},
			{
				name: "audio-produce",
				target: "audio-edit",
				target_type: "skill",
				match: { field: "kind", value: "audio" },
				priority: 10,
				enabled: true,
			},
		],
	},
	dispatch: {
		verb: "dispatch",
		default_target: "gh-cli",
		default_target_type: "mcp",
		rules: [
			{
				name: "memory-extract",
				target: "memory-extract",
				target_type: "skill",
				match: { field: "action", value: "memory.extract" },
				priority: 10,
				enabled: true,
			},
		],
	},
	notify: {
		verb: "notify",
		default_target: "notify",
		default_target_type: "extension",
		rules: [],
	},
};

/**
 * Load a single verb's routing table from YAML, falling back to defaults.
 */
export function loadRoutingTable(verb: VerbName, metaSkillsDir?: string): RoutingTable {
	const dir = metaSkillsDir ?? DIRS.metaSkills;
	const yamlPath = path.join(dir, `${verb}.yaml`);

	if (!fs.existsSync(yamlPath)) {
		return DEFAULT_ROUTING_TABLES[verb];
	}

	let raw: string;
	try {
		raw = fs.readFileSync(yamlPath, "utf-8");
	} catch (err) {
		throw new RoutingLoadError(`Failed to read routing table at ${yamlPath}`, err);
	}

	let parsed: unknown;
	try {
		parsed = YAML.parse(raw);
	} catch (err) {
		throw new RoutingLoadError(`Invalid YAML in routing table at ${yamlPath}`, err);
	}

	const result = RoutingTableSchema.safeParse(parsed);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
		throw new RoutingLoadError(`Routing table validation failed for ${verb}:\n${issues}`);
	}

	return result.data;
}

/**
 * Load all 8 verb routing tables.
 */
export function loadAllRoutingTables(metaSkillsDir?: string): Map<VerbName, RoutingTable> {
	const tables = new Map<VerbName, RoutingTable>();

	for (const verb of VERB_NAMES) {
		tables.set(verb, loadRoutingTable(verb, metaSkillsDir));
	}

	return tables;
}
