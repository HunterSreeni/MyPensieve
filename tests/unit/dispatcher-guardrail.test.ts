import { describe, expect, it, vi } from "vitest";
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

const ctx = { channelType: "cli" as const, project: "test-project" };

describe("GatewayDispatcher write-path guardrail", () => {
	it("blocks produce.output_path that targets a system file", async () => {
		const executor = vi.fn(async () => ({ ok: true }));
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), executor);
		await expect(
			dispatcher.dispatch(
				"produce",
				{ kind: "text", prompt: "hello", output_path: "/etc/shadow" },
				ctx,
			),
		).rejects.toThrow(GatewayDispatchError);
		expect(executor).not.toHaveBeenCalled();
	});

	it("blocks produce.output_path that targets ~/.ssh/", async () => {
		const executor = vi.fn(async () => ({ ok: true }));
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), executor);
		const homePath = process.env.HOME ?? "/home/user";
		await expect(
			dispatcher.dispatch(
				"produce",
				{ kind: "text", prompt: "hello", output_path: `${homePath}/.ssh/authorized_keys` },
				ctx,
			),
		).rejects.toThrow(/Denied by guardrail/);
		expect(executor).not.toHaveBeenCalled();
	});

	it("allows produce.output_path under cwd", async () => {
		const executor = vi.fn(async () => ({ ok: true }));
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), executor);
		await dispatcher.dispatch(
			"produce",
			{ kind: "text", prompt: "hello", output_path: `${process.cwd()}/out.md` },
			ctx,
		);
		expect(executor).toHaveBeenCalled();
	});

	it("allows produce with no output_path", async () => {
		const executor = vi.fn(async () => ({ ok: true }));
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), executor);
		await dispatcher.dispatch("produce", { kind: "text", prompt: "hello" }, ctx);
		expect(executor).toHaveBeenCalled();
	});
});
