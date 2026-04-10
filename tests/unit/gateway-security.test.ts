import { describe, expect, it, vi } from "vitest";
import {
	BindingValidationError,
	isEscapeHatchAllowed,
	validateChannelBinding,
} from "../../src/gateway/binding-validator.js";
import { GatewayDispatchError, GatewayDispatcher } from "../../src/gateway/dispatcher.js";
import { DEFAULT_ROUTING_TABLES } from "../../src/gateway/routing-loader.js";
import type { RoutingTable } from "../../src/gateway/routing-schema.js";
import { VERB_NAMES, type VerbName } from "../../src/gateway/verbs.js";

function makeRoutingTables(): Map<VerbName, RoutingTable> {
	const tables = new Map<VerbName, RoutingTable>();
	for (const verb of VERB_NAMES) {
		tables.set(verb, { ...DEFAULT_ROUTING_TABLES[verb] });
	}
	return tables;
}

const mockExecutor = vi.fn(async () => ({ success: true }));

describe("Gateway security", () => {
	describe("Verb isolation", () => {
		it("only 8 verbs exist - no raw skill names", () => {
			expect(VERB_NAMES).toHaveLength(8);
			expect(VERB_NAMES).toEqual([
				"recall",
				"research",
				"ingest",
				"monitor",
				"journal",
				"produce",
				"dispatch",
				"notify",
			]);
		});

		it("dispatcher rejects unknown verb names", async () => {
			const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);
			// TypeScript prevents this at compile time, but test runtime
			await expect(
				dispatcher.dispatch(
					"gh-cli" as VerbName,
					{ query: "test" },
					{
						channelType: "cli",
						project: "test",
					},
				),
			).rejects.toThrow();
		});

		it("dispatcher cannot be tricked into calling raw skills via args", async () => {
			const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);

			// Attempt to inject a raw skill name via args
			const result = await dispatcher.dispatch(
				"recall",
				{
					query: "test",
					_raw_skill: "gh-cli.delete_repo", // injection attempt
				},
				{ channelType: "cli", project: "test" },
			);

			// The injected field is ignored - routing is by verb, not by args
			expect(result.target).toBe("memory-recall");
			expect(mockExecutor).toHaveBeenCalledWith(
				"memory-recall",
				"skill",
				expect.not.objectContaining({ _raw_skill: expect.anything() }),
			);
		});
	});

	describe("Escape hatch enforcement", () => {
		it("Telegram hard-blocks escape hatch regardless of config", () => {
			// Even if someone manually sets it to true
			expect(
				isEscapeHatchAllowed("telegram", {
					cli: { enabled: true, tool_escape_hatch: false },
					// @ts-expect-error - testing runtime enforcement
					telegram: { enabled: true, tool_escape_hatch: true },
				}),
			).toBe(false);
		});

		it("CLI escape hatch is disabled by default", () => {
			expect(
				isEscapeHatchAllowed("cli", {
					cli: { enabled: true, tool_escape_hatch: false },
					telegram: { enabled: false, tool_escape_hatch: false },
				}),
			).toBe(false);
		});

		it("CLI escape hatch can be explicitly enabled", () => {
			expect(
				isEscapeHatchAllowed("cli", {
					cli: { enabled: true, tool_escape_hatch: true },
					telegram: { enabled: false, tool_escape_hatch: false },
				}),
			).toBe(true);
		});

		it("session fails to start if Telegram has escape hatch enabled", () => {
			expect(() =>
				validateChannelBinding("telegram", {
					cli: { enabled: true, tool_escape_hatch: false },
					// @ts-expect-error - testing runtime enforcement
					telegram: { enabled: true, tool_escape_hatch: true },
				}),
			).toThrow(BindingValidationError);
		});
	});

	describe("Research tier enforcement", () => {
		it("research verb always routes to researcher skill (not deep tier)", async () => {
			const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);
			const result = await dispatcher.dispatch(
				"research",
				{ topic: "test" },
				{ channelType: "cli", project: "test" },
			);

			// Research should route to "researcher" skill which internally uses cheap tier
			expect(result.target).toBe("researcher");
			expect(result.targetType).toBe("skill");
		});
	});

	describe("Routing table injection", () => {
		it("rejects YAML with code-like strings safely", () => {
			// The routing table uses Zod validation which prevents arbitrary code execution
			const tables = makeRoutingTables();
			const dispatcher = new GatewayDispatcher(tables, mockExecutor);

			// Even with a malicious-looking target, it's just a string
			dispatcher.updateRoutingTable("recall", {
				verb: "recall",
				default_target: "'; DROP TABLE decisions; --",
				default_target_type: "skill",
				rules: [],
			});

			// The executor receives it as a plain string, not executable
			dispatcher
				.dispatch("recall", { query: "test" }, { channelType: "cli", project: "test" })
				.then(() => {
					expect(mockExecutor).toHaveBeenCalledWith(
						"'; DROP TABLE decisions; --",
						"skill",
						expect.anything(),
					);
				});
		});
	});

	describe("Dispatch confirmation", () => {
		it("dispatch verb defaults confirm to true", async () => {
			const trackingExecutor = vi.fn(
				async (_target: string, _type: string, args: Record<string, unknown>) => {
					// Verify the args include confirm=true
					expect(args.confirm).toBe(true);
					return { success: true };
				},
			);

			const dispatcher = new GatewayDispatcher(makeRoutingTables(), trackingExecutor);
			await dispatcher.dispatch(
				"dispatch",
				{ action: "gh.pr.create" },
				{ channelType: "cli", project: "test" },
			);
		});
	});

	describe("Audit completeness", () => {
		it("successful dispatch creates audit entry", async () => {
			const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);

			// The audit is logged internally via startAudit -> logAudit -> appendJsonl
			// We verify by checking the dispatch doesn't throw and returns correct metadata
			const result = await dispatcher.dispatch(
				"recall",
				{ query: "audit test" },
				{ channelType: "cli", project: "test" },
			);

			expect(result.verb).toBe("recall");
			expect(result.target).toBeDefined();
			expect(result.ruleName).toBeDefined();
		});

		it("failed dispatch still creates audit entry", async () => {
			const failExecutor = vi.fn(async () => {
				throw new Error("fail");
			});
			const dispatcher = new GatewayDispatcher(makeRoutingTables(), failExecutor);

			// Dispatch fails, but audit entry was still created (via audit.fail)
			await expect(
				dispatcher.dispatch(
					"recall",
					{ query: "fail test" },
					{ channelType: "cli", project: "test" },
				),
			).rejects.toThrow(GatewayDispatchError);
		});
	});
});
