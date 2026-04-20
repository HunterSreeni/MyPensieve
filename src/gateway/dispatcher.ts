import { checkWriteAccess } from "../core/security/guardrails.js";
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
 * Operator confirmation request payload. Provided to confirm providers
 * (CLI prompt, Telegram inline keyboard, daemon auto-policy) when a
 * confirmation-required verb is about to execute.
 */
export interface ConfirmRequest {
	verb: VerbName;
	args: Record<string, unknown>;
	target: string;
	channelType: "cli" | "telegram";
	project: string;
}

export interface ConfirmResponse {
	approved: boolean;
	reason?: string;
}

/**
 * Confirmation provider contract. Returns an approval decision for a
 * destructive verb call. If no provider is installed on the dispatcher,
 * confirmation is skipped (preserves pre-v0.3.0 behavior).
 *
 * Verbs requiring confirmation today: `dispatch` (see CONFIRM_REQUIRED_VERBS).
 */
export type ConfirmProvider = (req: ConfirmRequest) => Promise<ConfirmResponse>;

/**
 * Verbs that require operator confirmation before execution when a
 * confirmProvider is installed. `dispatch` is the only destructive verb
 * today (external state: git, PRs, deployments). `produce` and `journal`
 * are local-only and not gated.
 */
export const CONFIRM_REQUIRED_VERBS: VerbName[] = ["dispatch"];

/**
 * The gateway dispatcher.
 * Receives a verb call, validates args, resolves routing, dispatches to executor, logs audit.
 */
export class GatewayDispatcher {
	private routingTables: Map<VerbName, RoutingTable>;
	private executor: SkillExecutor;
	private confirmProvider?: ConfirmProvider;

	constructor(
		routingTables: Map<VerbName, RoutingTable>,
		executor: SkillExecutor,
		confirmProvider?: ConfirmProvider,
	) {
		this.routingTables = routingTables;
		this.executor = executor;
		this.confirmProvider = confirmProvider;
	}

	/** Install or replace the confirm provider at runtime (used by channel wiring). */
	setConfirmProvider(provider: ConfirmProvider | undefined): void {
		this.confirmProvider = provider;
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

		// Step 1.5: Path-level guardrail for verbs that accept an output_path.
		// The filesystem tool-guard runs inside Pi's session and only covers
		// raw read/write/edit/bash tools. Verb args with paths (produce.output_path)
		// don't pass through that hook, so validate them here against the same
		// write allow-list used by the tool-guard.
		if (verb === "produce" && typeof validatedArgs.output_path === "string") {
			const check = checkWriteAccess(validatedArgs.output_path, process.cwd());
			if (!check.allowed) {
				throw new GatewayDispatchError(
					verb,
					`Denied by guardrail: output_path ${check.reason ?? "rejected"}`,
				);
			}
		}

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

		// Step 2.5: Operator confirmation for destructive verbs.
		// Only enforced when a confirmProvider is installed (channels install one;
		// bare tests/dispatcher construction without a provider skip this step to
		// preserve backward-compatible behavior).
		//
		// Security note: we intentionally IGNORE `validatedArgs.confirm` for
		// CONFIRM_REQUIRED_VERBS. Allowing the agent to self-opt-out would let
		// prompt injection bypass operator approval by setting confirm:false.
		// The provider decides - not the LLM.
		if (CONFIRM_REQUIRED_VERBS.includes(verb) && this.confirmProvider) {
			const decision = await this.confirmProvider({
				verb,
				args: validatedArgs,
				target: route.target,
				channelType: ctx.channelType,
				project: ctx.project,
			});
			if (!decision.approved) {
				// Log the denial as a fail so audit readers can distinguish
				// "executed successfully" from "operator refused to approve".
				audit.fail(new Error(`operator_denied${decision.reason ? `: ${decision.reason}` : ""}`));
				return {
					verb,
					target: route.target,
					targetType: route.target_type,
					ruleName: route.rule_name,
					result: {
						action: (validatedArgs.action as string) ?? route.target,
						success: false,
						output: `operator_denied${decision.reason ? `: ${decision.reason}` : ""}`,
					},
				};
			}
		}

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
