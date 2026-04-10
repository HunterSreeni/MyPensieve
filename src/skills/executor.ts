import type { Config } from "../config/schema.js";
import type { ProjectState } from "../projects/loader.js";

/**
 * Result from a skill execution.
 */
export interface SkillResult {
	success: boolean;
	data: unknown;
	error?: string;
}

/**
 * A skill implementation function.
 */
export type SkillHandler = (
	args: Record<string, unknown>,
	ctx: SkillContext,
) => Promise<SkillResult>;

/**
 * Context available to all skills during execution.
 */
export interface SkillContext {
	project: ProjectState;
	config: Config;
	channelType: "cli" | "telegram";
	sessionId: string;
}

/**
 * Registry of skill implementations.
 * Maps skill names to handler functions.
 */
export class SkillRegistry {
	private handlers = new Map<string, SkillHandler>();

	register(name: string, handler: SkillHandler): void {
		this.handlers.set(name, handler);
	}

	has(name: string): boolean {
		return this.handlers.has(name);
	}

	get(name: string): SkillHandler | undefined {
		return this.handlers.get(name);
	}

	list(): string[] {
		return Array.from(this.handlers.keys());
	}

	/**
	 * Execute a skill by name.
	 */
	async execute(
		name: string,
		args: Record<string, unknown>,
		ctx: SkillContext,
	): Promise<SkillResult> {
		const handler = this.handlers.get(name);
		if (!handler) {
			return {
				success: false,
				data: null,
				error: `Unknown skill: ${name}. Available: ${this.list().join(", ")}`,
			};
		}

		try {
			return await handler(args, ctx);
		} catch (err) {
			return {
				success: false,
				data: null,
				error: `Skill '${name}' threw: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}
}

/**
 * Create a unified executor function for the gateway dispatcher.
 * Routes skill calls to the registry, MCP calls to a stub (Phase 5+).
 */
export function createUnifiedExecutor(
	registry: SkillRegistry,
	ctx: SkillContext,
): (target: string, targetType: string, args: Record<string, unknown>) => Promise<unknown> {
	return async (target, targetType, args) => {
		if (targetType === "skill" || targetType === "extension") {
			if (!registry.has(target)) {
				// Graceful stub for unregistered skills (e.g. external skill repos, future extensions)
				return {
					status: "not_registered",
					target,
					targetType,
					message: `Skill '${target}' is not registered. It may be an external skill or extension not yet installed.`,
				};
			}
			const result = await registry.execute(target, args, ctx);
			if (!result.success) {
				throw new Error(result.error ?? `Skill '${target}' failed`);
			}
			return result.data;
		}

		if (targetType === "mcp") {
			// MCP dispatch - stubs for now, real MCP client in later integration
			return { status: "mcp_not_connected", target, args };
		}

		throw new Error(`Unknown target type: ${targetType}`);
	};
}
