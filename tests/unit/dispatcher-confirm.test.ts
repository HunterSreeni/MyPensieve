import { describe, expect, it, vi } from "vitest";
import { createAutoPolicyConfirmProvider } from "../../src/gateway/confirm-providers.js";
import { type ConfirmProvider, GatewayDispatcher } from "../../src/gateway/dispatcher.js";
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

const ctx = { channelType: "cli" as const, project: "test-project" };

describe("GatewayDispatcher confirm enforcement", () => {
	it("executes dispatch verb when no confirm provider installed (backward compat)", async () => {
		const executor = vi.fn(async () => ({ action: "git.status", success: true }));
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), executor);
		const result = await dispatcher.dispatch("dispatch", { action: "git.status" }, ctx);
		expect(executor).toHaveBeenCalled();
		expect((result.result as { success: boolean }).success).toBe(true);
	});

	it("blocks dispatch verb when provider denies", async () => {
		const executor = vi.fn(async () => ({ action: "git.push", success: true }));
		const provider: ConfirmProvider = async () => ({
			approved: false,
			reason: "operator declined",
		});
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), executor, provider);
		const result = await dispatcher.dispatch("dispatch", { action: "git.push" }, ctx);
		expect(executor).not.toHaveBeenCalled();
		const payload = result.result as { success: boolean; output: string };
		expect(payload.success).toBe(false);
		expect(payload.output).toContain("operator_denied");
		expect(payload.output).toContain("operator declined");
	});

	it("proceeds when provider approves", async () => {
		const executor = vi.fn(async () => ({ action: "git.push", success: true }));
		const provider: ConfirmProvider = async () => ({ approved: true });
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), executor, provider);
		const result = await dispatcher.dispatch("dispatch", { action: "git.push" }, ctx);
		expect(executor).toHaveBeenCalled();
		expect((result.result as { success: boolean }).success).toBe(true);
	});

	it("ignores args.confirm:false from the agent (no self-bypass)", async () => {
		// Security: the LLM controls `args` but must not be able to skip the
		// confirm provider by setting confirm:false. The provider decides.
		const executor = vi.fn(async () => ({ action: "git.status", success: true }));
		const provider = vi.fn(async () => ({ approved: false, reason: "denied" }));
		const dispatcher = new GatewayDispatcher(
			makeRoutingTables(),
			executor,
			provider as ConfirmProvider,
		);
		const result = await dispatcher.dispatch(
			"dispatch",
			{ action: "git.status", confirm: false },
			ctx,
		);
		expect(provider).toHaveBeenCalledOnce();
		expect(executor).not.toHaveBeenCalled();
		expect((result.result as { success: boolean }).success).toBe(false);
	});

	it("does not gate non-dispatch verbs", async () => {
		const executor = vi.fn(async () => ({ success: true, data: "mock" }));
		const provider = vi.fn(async () => ({ approved: false }));
		const dispatcher = new GatewayDispatcher(
			makeRoutingTables(),
			executor,
			provider as ConfirmProvider,
		);
		await dispatcher.dispatch("journal", { action: "read" }, ctx);
		expect(provider).not.toHaveBeenCalled();
		expect(executor).toHaveBeenCalled();
	});

	it("auto-deny policy provider blocks dispatch", async () => {
		const executor = vi.fn(async () => ({ action: "git.push", success: true }));
		const dispatcher = new GatewayDispatcher(
			makeRoutingTables(),
			executor,
			createAutoPolicyConfirmProvider("deny"),
		);
		const result = await dispatcher.dispatch("dispatch", { action: "git.push" }, ctx);
		expect(executor).not.toHaveBeenCalled();
		expect((result.result as { success: boolean }).success).toBe(false);
	});

	it("auto-allow policy provider approves dispatch", async () => {
		const executor = vi.fn(async () => ({ action: "git.push", success: true }));
		const dispatcher = new GatewayDispatcher(
			makeRoutingTables(),
			executor,
			createAutoPolicyConfirmProvider("allow"),
		);
		const result = await dispatcher.dispatch("dispatch", { action: "git.push" }, ctx);
		expect(executor).toHaveBeenCalled();
		expect((result.result as { success: boolean }).success).toBe(true);
	});

	it("setConfirmProvider swaps provider at runtime", async () => {
		const executor = vi.fn(async () => ({ action: "git.push", success: true }));
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), executor);
		// No provider - proceeds
		await dispatcher.dispatch("dispatch", { action: "git.push" }, ctx);
		expect(executor).toHaveBeenCalledTimes(1);
		// Install deny provider - next call blocks
		dispatcher.setConfirmProvider(createAutoPolicyConfirmProvider("deny"));
		await dispatcher.dispatch("dispatch", { action: "git.push" }, ctx);
		expect(executor).toHaveBeenCalledTimes(1);
	});
});
