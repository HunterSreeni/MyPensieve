import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import {
	DEFAULT_ROUTING_TABLES,
	RoutingLoadError,
	loadAllRoutingTables,
	loadRoutingTable,
} from "../../src/gateway/routing-loader.js";
import { VERB_NAMES } from "../../src/gateway/verbs.js";

describe("Routing table loader", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-routing-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns default table when no YAML exists", () => {
		const table = loadRoutingTable("recall", tmpDir);
		expect(table).toEqual(DEFAULT_ROUTING_TABLES.recall);
	});

	it("has default tables for all 8 verbs", () => {
		for (const verb of VERB_NAMES) {
			expect(DEFAULT_ROUTING_TABLES[verb]).toBeDefined();
			expect(DEFAULT_ROUTING_TABLES[verb].verb).toBe(verb);
		}
	});

	it("loads a valid YAML routing table", () => {
		const customTable = {
			verb: "recall",
			default_target: "custom-recall",
			default_target_type: "skill",
			rules: [
				{
					name: "semantic-search",
					target: "semantic-index",
					target_type: "extension",
					match: { has_field: "embedding" },
					priority: 5,
					enabled: true,
				},
			],
		};

		fs.writeFileSync(path.join(tmpDir, "recall.yaml"), YAML.stringify(customTable), "utf-8");
		const table = loadRoutingTable("recall", tmpDir);

		expect(table.default_target).toBe("custom-recall");
		expect(table.rules).toHaveLength(1);
		expect(table.rules[0]?.name).toBe("semantic-search");
	});

	it("throws on invalid YAML syntax", () => {
		fs.writeFileSync(path.join(tmpDir, "recall.yaml"), "{{invalid yaml", "utf-8");
		expect(() => loadRoutingTable("recall", tmpDir)).toThrow(RoutingLoadError);
	});

	it("throws on valid YAML but invalid schema", () => {
		fs.writeFileSync(
			path.join(tmpDir, "recall.yaml"),
			YAML.stringify({ verb: "recall", missing_required: true }),
			"utf-8",
		);
		expect(() => loadRoutingTable("recall", tmpDir)).toThrow(RoutingLoadError);
	});

	it("loads all 8 routing tables", () => {
		const tables = loadAllRoutingTables(tmpDir);
		expect(tables.size).toBe(8);

		for (const verb of VERB_NAMES) {
			expect(tables.has(verb)).toBe(true);
		}
	});

	it("mixes defaults and custom tables", () => {
		const customRecall = {
			verb: "recall",
			default_target: "custom-recall",
			default_target_type: "skill",
			rules: [],
		};
		fs.writeFileSync(path.join(tmpDir, "recall.yaml"), YAML.stringify(customRecall), "utf-8");

		const tables = loadAllRoutingTables(tmpDir);
		expect(tables.get("recall")?.default_target).toBe("custom-recall");
		expect(tables.get("research")?.default_target).toBe("researcher"); // default
	});
});
