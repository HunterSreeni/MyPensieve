import type { ExtensionAPI, ExtensionFactory, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";

import { readConfig } from "../config/reader.js";
import { isEscapeHatchAllowed } from "./binding-validator.js";
import {
	type ConfirmProvider,
	type DispatchContext,
	GatewayDispatcher,
	type SkillExecutor,
} from "./dispatcher.js";
import { loadAllRoutingTables } from "./routing-loader.js";
import { VERB_NAMES, type VerbName } from "./verbs.js";

/**
 * Build Pi ToolDefinitions for each of the 8 verbs.
 * These are what the agent sees in its tool list.
 */
function buildVerbToolDefinitions(
	dispatcher: GatewayDispatcher,
	ctx: DispatchContext,
): ToolDefinition[] {
	return VERB_NAMES.map((verb) => createVerbTool(verb, dispatcher, ctx));
}

function createVerbTool(
	verb: VerbName,
	dispatcher: GatewayDispatcher,
	ctx: DispatchContext,
): ToolDefinition {
	const descriptions: Record<VerbName, string> = {
		recall: "Query persistent memory across decisions, threads, persona, and semantic layers",
		research: "Investigate an external topic - search, gather sources, synthesize with citations",
		ingest: "Convert an external artifact (file, URL, audio, video, image) into structured text",
		monitor:
			"Check for changes since last invocation (CVEs, packages, GitHub, feeds, cron, backup)",
		journal: "Read/write daily-log entries, run weekly reviews, query mood/energy trends",
		produce: "Create content artifacts: text drafts, images, videos, audio, blog posts",
		dispatch: "Execute persistent external state changes: git, GitHub PRs, deployments",
		notify: "Send messages to surfacing channels (inline, digest, Telegram, error log)",
	};

	// Using a generic object schema - verb-specific validation happens in the dispatcher
	const argsSchema = Type.Object({
		args: Type.Record(Type.String(), Type.Unknown(), {
			description: `Arguments for the ${verb} verb. See verb documentation for required fields.`,
		}),
	});

	return {
		name: verb,
		description: descriptions[verb],
		parameters: argsSchema,
		async execute(_toolCallId: string, params: Static<typeof argsSchema>) {
			const result = await dispatcher.dispatch(verb, params.args as Record<string, unknown>, ctx);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(result.result, null, 2),
					},
				],
				details: {
					verb,
					target: result.target,
					targetType: result.targetType,
					ruleName: result.ruleName,
				},
			};
		},
		label: `MyPensieve: ${verb}`,
	};
}

/**
 * Build the optional tool() escape hatch tool definition.
 */
function buildEscapeHatchTool(executor: SkillExecutor): ToolDefinition {
	const schema = Type.Object({
		name: Type.String({ description: "The raw skill or MCP tool name to invoke" }),
		args: Type.Record(Type.String(), Type.Unknown(), {
			description: "Arguments to pass to the tool",
		}),
	});

	return {
		name: "tool",
		description:
			"Escape hatch: invoke a raw skill or MCP by name. Only available when explicitly enabled. Use verb tools instead when possible.",
		parameters: schema,
		async execute(_toolCallId: string, params: Static<typeof schema>) {
			const result = await executor(params.name, "skill", params.args as Record<string, unknown>);
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
				details: { escapedTool: params.name },
			};
		},
		label: "MyPensieve: tool (escape hatch)",
	};
}

/**
 * Create the gateway extension factory.
 *
 * This extension:
 * 1. On session_start: loads routing tables, builds verb tools, replaces agent's tool list
 * 2. Optionally adds the tool() escape hatch if the channel allows it
 * 3. All agent-tool interaction goes through the 8 verb gateway
 */
export function createGatewayExtension(options: {
	channelType: "cli" | "telegram";
	project: string;
	executor: SkillExecutor;
	confirmProvider?: ConfirmProvider;
	configPath?: string;
	metaSkillsDir?: string;
}): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		pi.on("session_start", () => {
			const routingTables = loadAllRoutingTables(options.metaSkillsDir);
			const dispatcher = new GatewayDispatcher(
				routingTables,
				options.executor,
				options.confirmProvider,
			);

			const ctx: DispatchContext = {
				channelType: options.channelType,
				project: options.project,
			};

			// Build the 8 verb tools
			const verbTools = buildVerbToolDefinitions(dispatcher, ctx);

			// Register each verb tool
			for (const tool of verbTools) {
				pi.registerTool(tool);
			}

			// Optionally add escape hatch
			try {
				const config = readConfig(options.configPath);
				if (isEscapeHatchAllowed(options.channelType, config.channels)) {
					pi.registerTool(buildEscapeHatchTool(options.executor));
				}
			} catch {
				// Config read failure - no escape hatch (safe default)
			}

			// Replace the active tools list with just our verb tools
			const activeToolNames = verbTools.map((t) => t.name);
			// Also keep the built-in Pi tools the agent needs (read, bash, edit, write)
			const piBuiltIns = pi
				.getActiveTools()
				.filter((t) => ["read", "bash", "edit", "write", "grep", "find", "ls"].includes(t));
			pi.setActiveTools([...piBuiltIns, ...activeToolNames]);
		});
	};
}
