import { z } from "zod";
/**
 * Schema for a single routing rule in a verb's YAML routing table.
 * Each rule maps a condition to a target skill or MCP.
 */
export const RoutingRuleSchema = z.object({
	/** Human-readable name for this route */
	name: z.string().min(1),

	/** The underlying skill or MCP to dispatch to */
	target: z.string().min(1), // e.g. "memory-recall", "duckduckgo-search"

	/** Whether the target is a skill or MCP */
	target_type: z.enum(["skill", "mcp", "extension"]),

	/** Optional condition - when to use this route (matched against verb args) */
	match: z
		.object({
			/** Match on a specific arg field value */
			field: z.string().optional(),
			value: z.union([z.string(), z.array(z.string())]).optional(),
			/** Match on arg field presence */
			has_field: z.string().optional(),
		})
		.optional(),

	/** Priority - lower number = higher priority. Default 100. */
	priority: z.number().int().default(100),

	/** Whether this route is enabled */
	enabled: z.boolean().default(true),
});

export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

/**
 * Schema for a complete verb routing table (one per verb).
 * Lives at ~/.mypensieve/meta-skills/<verb>.yaml
 */
export const RoutingTableSchema = z.object({
	/** Which verb this table routes */
	verb: z.string().min(1),

	/** Default target if no rules match */
	default_target: z.string().min(1),
	default_target_type: z.enum(["skill", "mcp", "extension"]),

	/** Ordered list of routing rules */
	rules: z.array(RoutingRuleSchema).default([]),
});

export type RoutingTable = z.infer<typeof RoutingTableSchema>;

/**
 * Find the matching route for given verb args.
 * Returns the first matching rule (by priority), or the default target.
 */
export function resolveRoute(
	table: RoutingTable,
	args: Record<string, unknown>,
): { target: string; target_type: "skill" | "mcp" | "extension"; rule_name: string } {
	// Sort enabled rules by priority (ascending)
	const activeRules = table.rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);

	for (const rule of activeRules) {
		if (!rule.match) {
			// No condition = always matches
			return { target: rule.target, target_type: rule.target_type, rule_name: rule.name };
		}

		// Check field value match
		if (rule.match.field && rule.match.value !== undefined) {
			const argValue = args[rule.match.field];
			const matchValues = Array.isArray(rule.match.value) ? rule.match.value : [rule.match.value];
			if (typeof argValue === "string" && matchValues.includes(argValue)) {
				return { target: rule.target, target_type: rule.target_type, rule_name: rule.name };
			}
		}

		// Check field presence match
		if (rule.match.has_field) {
			if (rule.match.has_field in args) {
				return { target: rule.target, target_type: rule.target_type, rule_name: rule.name };
			}
		}
	}

	// Default target
	return {
		target: table.default_target,
		target_type: table.default_target_type,
		rule_name: "default",
	};
}
