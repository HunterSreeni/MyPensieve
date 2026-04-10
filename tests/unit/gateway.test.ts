import { describe, it, expect } from "vitest";
import {
	VERB_NAMES,
	VERB_SCHEMAS,
	READ_VERBS,
	WRITE_VERBS,
	LLM_ROUTED_VERB,
	RecallArgsSchema,
	ResearchArgsSchema,
	DispatchArgsSchema,
	NotifyArgsSchema,
	JournalArgsSchema,
	ProduceArgsSchema,
} from "../../src/gateway/verbs.js";
import {
	RoutingTableSchema,
	resolveRoute,
	type RoutingTable,
} from "../../src/gateway/routing-schema.js";
import {
	validateChannelBinding,
	isEscapeHatchAllowed,
	BindingValidationError,
} from "../../src/gateway/binding-validator.js";

// --- Verb definitions ---

describe("Verb definitions", () => {
	it("has exactly 8 verbs", () => {
		expect(VERB_NAMES).toHaveLength(8);
	});

	it("has schemas for all verbs", () => {
		for (const verb of VERB_NAMES) {
			expect(VERB_SCHEMAS[verb]).toBeDefined();
			expect(VERB_SCHEMAS[verb].args).toBeDefined();
			expect(VERB_SCHEMAS[verb].result).toBeDefined();
		}
	});

	it("partitions into read and write verbs correctly", () => {
		expect([...READ_VERBS, ...WRITE_VERBS].sort()).toEqual([...VERB_NAMES].sort());
	});

	it("research is the only LLM-routed verb", () => {
		expect(LLM_ROUTED_VERB).toBe("research");
	});
});

// --- Verb arg validation ---

describe("Verb arg validation", () => {
	it("recall requires query", () => {
		expect(RecallArgsSchema.safeParse({}).success).toBe(false);
		expect(RecallArgsSchema.safeParse({ query: "test" }).success).toBe(true);
	});

	it("recall accepts optional layer filter", () => {
		const result = RecallArgsSchema.safeParse({
			query: "test",
			layers: ["decisions", "threads"],
		});
		expect(result.success).toBe(true);
	});

	it("recall rejects invalid layer names", () => {
		const result = RecallArgsSchema.safeParse({
			query: "test",
			layers: ["invalid_layer"],
		});
		expect(result.success).toBe(false);
	});

	it("research requires topic", () => {
		expect(ResearchArgsSchema.safeParse({}).success).toBe(false);
		expect(ResearchArgsSchema.safeParse({ topic: "AI safety" }).success).toBe(true);
	});

	it("research defaults depth to standard", () => {
		const result = ResearchArgsSchema.parse({ topic: "test" });
		expect(result.depth).toBe("standard");
	});

	it("dispatch requires action", () => {
		expect(DispatchArgsSchema.safeParse({}).success).toBe(false);
		expect(DispatchArgsSchema.safeParse({ action: "gh.pr.create" }).success).toBe(true);
	});

	it("dispatch defaults confirm to true", () => {
		const result = DispatchArgsSchema.parse({ action: "git.push" });
		expect(result.confirm).toBe(true);
	});

	it("notify defaults severity to info", () => {
		const result = NotifyArgsSchema.parse({ message: "test" });
		expect(result.severity).toBe("info");
	});

	it("journal requires action", () => {
		expect(JournalArgsSchema.safeParse({}).success).toBe(false);
		expect(JournalArgsSchema.safeParse({ action: "read" }).success).toBe(true);
	});

	it("journal validates mood score range", () => {
		const valid = JournalArgsSchema.safeParse({
			action: "write",
			entry: { mood_score: 3 },
		});
		expect(valid.success).toBe(true);

		const invalid = JournalArgsSchema.safeParse({
			action: "write",
			entry: { mood_score: 6 },
		});
		expect(invalid.success).toBe(false);
	});

	it("produce requires kind and prompt", () => {
		expect(ProduceArgsSchema.safeParse({}).success).toBe(false);
		expect(ProduceArgsSchema.safeParse({ kind: "blog-post" }).success).toBe(false);
		expect(
			ProduceArgsSchema.safeParse({ kind: "blog-post", prompt: "write about AI" }).success,
		).toBe(true);
	});
});

// --- Routing table ---

describe("Routing table", () => {
	const table: RoutingTable = {
		verb: "monitor",
		default_target: "generic-monitor",
		default_target_type: "extension",
		rules: [
			{
				name: "cve-monitor",
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
				priority: 20,
				enabled: true,
			},
			{
				name: "disabled-rule",
				target: "something",
				target_type: "skill",
				match: { field: "target", value: "feeds" },
				priority: 5,
				enabled: false,
			},
		],
	};

	it("validates a correct routing table", () => {
		const result = RoutingTableSchema.safeParse(table);
		expect(result.success).toBe(true);
	});

	it("resolves to matching rule by field value", () => {
		const route = resolveRoute(table, { target: "cves" });
		expect(route.target).toBe("cve-monitor");
		expect(route.rule_name).toBe("cve-monitor");
	});

	it("resolves to github rule for github target", () => {
		const route = resolveRoute(table, { target: "github" });
		expect(route.target).toBe("gh-cli");
		expect(route.target_type).toBe("mcp");
	});

	it("falls back to default when no rule matches", () => {
		const route = resolveRoute(table, { target: "something_else" });
		expect(route.target).toBe("generic-monitor");
		expect(route.rule_name).toBe("default");
	});

	it("skips disabled rules", () => {
		const route = resolveRoute(table, { target: "feeds" });
		expect(route.target).toBe("generic-monitor"); // disabled rule skipped, falls to default
		expect(route.rule_name).toBe("default");
	});

	it("respects priority ordering", () => {
		const multiMatchTable: RoutingTable = {
			verb: "test",
			default_target: "default",
			default_target_type: "skill",
			rules: [
				{
					name: "low-priority",
					target: "low",
					target_type: "skill",
					priority: 100,
					enabled: true,
				},
				{
					name: "high-priority",
					target: "high",
					target_type: "skill",
					priority: 1,
					enabled: true,
				},
			],
		};
		// Both rules have no match condition, so both match. Higher priority (lower number) wins.
		const route = resolveRoute(multiMatchTable, {});
		expect(route.target).toBe("high");
	});

	it("matches on array values", () => {
		const route = resolveRoute(table, { target: "packages" });
		expect(route.target).toBe("cve-monitor");
	});
});

// --- Binding validator ---

describe("Binding validator", () => {
	it("passes for enabled CLI channel", () => {
		expect(() =>
			validateChannelBinding("cli", {
				cli: { enabled: true, tool_escape_hatch: false },
				telegram: { enabled: false, tool_escape_hatch: false },
			}),
		).not.toThrow();
	});

	it("throws for disabled channel", () => {
		expect(() =>
			validateChannelBinding("telegram", {
				cli: { enabled: true, tool_escape_hatch: false },
				telegram: { enabled: false, tool_escape_hatch: false },
			}),
		).toThrow(BindingValidationError);
	});

	it("throws for telegram with escape hatch enabled", () => {
		expect(() =>
			validateChannelBinding("telegram", {
				cli: { enabled: true, tool_escape_hatch: false },
				// @ts-expect-error - testing runtime enforcement
				telegram: { enabled: true, tool_escape_hatch: true },
			}),
		).toThrow(BindingValidationError);
		expect(() =>
			validateChannelBinding("telegram", {
				cli: { enabled: true, tool_escape_hatch: false },
				// @ts-expect-error - testing runtime enforcement
				telegram: { enabled: true, tool_escape_hatch: true },
			}),
		).toThrow("Security violation");
	});

	it("allows CLI escape hatch when configured", () => {
		const channels = {
			cli: { enabled: true, tool_escape_hatch: true },
			telegram: { enabled: false, tool_escape_hatch: false as const },
		};
		expect(isEscapeHatchAllowed("cli", channels)).toBe(true);
	});

	it("always blocks telegram escape hatch regardless of config", () => {
		const channels = {
			cli: { enabled: true, tool_escape_hatch: false },
			// @ts-expect-error - testing runtime enforcement
			telegram: { enabled: true, tool_escape_hatch: true },
		};
		expect(isEscapeHatchAllowed("telegram", channels)).toBe(false);
	});
});
