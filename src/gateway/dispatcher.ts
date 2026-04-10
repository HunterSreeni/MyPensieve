import { startAudit } from "./audit.js";
import type { RoutingTable } from "./routing-schema.js";
import { resolveRoute } from "./routing-schema.js";
import { VERB_SCHEMAS, type VerbName } from "./verbs.js";

export interface DispatchContext {
	channelType: "cli" | "telegram";
	project: string;
}

export interface DispatchResult {
	verb: VerbName;
	target: string;
	targetType: "skill" | "mcp" | "extension";
	ruleName: string;
	result: unknown;
}

/**
 * Skill/MCP executor function type.
 * The gateway doesn't know how to execute skills/MCPs directly -
 * it delegates to an executor provided by the host process.
 *
 * Phase 5 will provide real executors. For now, this is the contract.
 */
export type SkillExecutor = (
	target: string,
	targetType: "skill" | "mcp" | "extension",
	args: Record<string, unknown>,
) => Promise<unknown>;

/**
 * The gateway dispatcher.
 * Receives a verb call, validates args, resolves routing, dispatches to executor, logs audit.
 */
export class GatewayDispatcher {
	private routingTables: Map<VerbName, RoutingTable>;
	private executor: SkillExecutor;

	constructor(routingTables: Map<VerbName, RoutingTable>, executor: SkillExecutor) {
		this.routingTables = routingTables;
		this.executor = executor;
	}

	/**
	 * Dispatch a verb call.
	 *
	 * 1. Validate args against verb schema
	 * 2. Resolve route from routing table
	 * 3. Execute via executor
	 * 4. Log audit entry
	 * 5. Validate result against verb result schema
	 */
	async dispatch(
		verb: VerbName,
		rawArgs: Record<string, unknown>,
		ctx: DispatchContext,
	): Promise<DispatchResult> {
		// Step 1: Validate args
		const schema = VERB_SCHEMAS[verb];
		const argsResult = schema.args.safeParse(rawArgs);
		if (!argsResult.success) {
			const issues = argsResult.error.issues
				.map((i) => `${i.path.join(".")}: ${i.message}`)
				.join("; ");
			throw new GatewayDispatchError(verb, `Invalid args: ${issues}`);
		}
		const validatedArgs = argsResult.data as Record<string, unknown>;

		// Step 2: Resolve route
		// Use rawArgs for routing so custom fields (e.g. from skill frontmatter match)
		// are visible to the route resolver. Validated args go to the executor.
		const table = this.routingTables.get(verb);
		if (!table) {
			throw new GatewayDispatchError(verb, `No routing table found for verb '${verb}'`);
		}

		const route = resolveRoute(table, rawArgs);
		const audit = startAudit(
			verb,
			route.target,
			route.target_type,
			route.rule_name,
			ctx.channelType,
			ctx.project,
		);

		// Step 3: Execute
		let result: unknown;
		try {
			result = await this.executor(route.target, route.target_type, validatedArgs);
			audit.succeed();
		} catch (err) {
			audit.fail(err);
			throw new GatewayDispatchError(
				verb,
				`Execution failed for ${route.target}: ${err instanceof Error ? err.message : String(err)}`,
				err,
			);
		}

		return {
			verb,
			target: route.target,
			targetType: route.target_type,
			ruleName: route.rule_name,
			result,
		};
	}

	/** Update a routing table at runtime (for custom skill registration) */
	updateRoutingTable(verb: VerbName, table: RoutingTable): void {
		this.routingTables.set(verb, table);
	}

	/** Get a routing table (for inspection/testing) */
	getRoutingTable(verb: VerbName): RoutingTable | undefined {
		return this.routingTables.get(verb);
	}
}

export class GatewayDispatchError extends Error {
	constructor(
		public readonly verb: string,
		message: string,
		public readonly cause?: unknown,
	) {
		super(`[gateway:${verb}] ${message}`);
		this.name = "GatewayDispatchError";
	}
}
