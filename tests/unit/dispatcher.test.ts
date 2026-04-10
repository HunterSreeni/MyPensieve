import { describe, it, expect, vi } from "vitest";
import { GatewayDispatcher, GatewayDispatchError } from "../../src/gateway/dispatcher.js";
import { DEFAULT_ROUTING_TABLES } from "../../src/gateway/routing-loader.js";
import type { VerbName } from "../../src/gateway/verbs.js";
import { VERB_NAMES } from "../../src/gateway/verbs.js";
import type { RoutingTable } from "../../src/gateway/routing-schema.js";

function makeRoutingTables(): Map<VerbName, RoutingTable> {
	const tables = new Map<VerbName, RoutingTable>();
	for (const verb of VERB_NAMES) {
		tables.set(verb, { ...DEFAULT_ROUTING_TABLES[verb] });
	}
	return tables;
}

const mockExecutor = vi.fn(async () => ({ success: true, data: "mock result" }));
const ctx = { channelType: "cli" as const, project: "test-project" };

describe("GatewayDispatcher", () => {
	it("dispatches recall verb to memory-recall skill", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);
		const result = await dispatcher.dispatch("recall", { query: "test query" }, ctx);

		expect(result.verb).toBe("recall");
		expect(result.target).toBe("memory-recall");
		expect(result.targetType).toBe("skill");
		expect(mockExecutor).toHaveBeenCalledWith("memory-recall", "skill", expect.objectContaining({ query: "test query" }));
	});

	it("dispatches research verb to researcher skill", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);
		const result = await dispatcher.dispatch("research", { topic: "AI safety" }, ctx);

		expect(result.target).toBe("researcher");
	});

	it("dispatches journal verb to daily-log skill", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);
		const result = await dispatcher.dispatch("journal", { action: "read" }, ctx);

		expect(result.target).toBe("daily-log");
	});

	it("dispatches monitor with target=cves to cve-monitor", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);
		const result = await dispatcher.dispatch("monitor", { target: "cves" }, ctx);

		expect(result.target).toBe("cve-monitor");
		expect(result.ruleName).toBe("cve-packages");
	});

	it("dispatches monitor with target=github to gh-cli", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);
		const result = await dispatcher.dispatch("monitor", { target: "github" }, ctx);

		expect(result.target).toBe("gh-cli");
		expect(result.targetType).toBe("mcp");
	});

	it("dispatches produce with kind=image to image-edit", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);
		const result = await dispatcher.dispatch(
			"produce",
			{ kind: "image", prompt: "a sunset" },
			ctx,
		);

		expect(result.target).toBe("image-edit");
	});

	it("dispatches produce with kind=blog-post to blog-seo (default)", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);
		const result = await dispatcher.dispatch(
			"produce",
			{ kind: "blog-post", prompt: "write about AI" },
			ctx,
		);

		expect(result.target).toBe("blog-seo");
		expect(result.ruleName).toBe("default");
	});

	it("throws GatewayDispatchError on invalid args", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);

		await expect(dispatcher.dispatch("recall", {}, ctx)).rejects.toThrow(GatewayDispatchError);
		await expect(dispatcher.dispatch("recall", {}, ctx)).rejects.toThrow("Invalid args");
	});

	it("throws GatewayDispatchError on executor failure", async () => {
		const failingExecutor = vi.fn(async () => {
			throw new Error("MCP crashed");
		});
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), failingExecutor);

		await expect(
			dispatcher.dispatch("recall", { query: "test" }, ctx),
		).rejects.toThrow("Execution failed");
	});

	it("validates research args (requires topic)", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);

		await expect(dispatcher.dispatch("research", {}, ctx)).rejects.toThrow("Invalid args");
	});

	it("validates dispatch args (requires action)", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);

		await expect(dispatcher.dispatch("dispatch", {}, ctx)).rejects.toThrow("Invalid args");
	});

	it("validates notify args (requires message)", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);

		await expect(dispatcher.dispatch("notify", {}, ctx)).rejects.toThrow("Invalid args");
	});

	it("updates routing table at runtime", async () => {
		const dispatcher = new GatewayDispatcher(makeRoutingTables(), mockExecutor);

		dispatcher.updateRoutingTable("recall", {
			verb: "recall",
			default_target: "custom-recall",
			default_target_type: "skill",
			rules: [],
		});

		const result = await dispatcher.dispatch("recall", { query: "test" }, ctx);
		expect(result.target).toBe("custom-recall");
	});
});
