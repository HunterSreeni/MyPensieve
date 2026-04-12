import type {
	ExtensionAPI,
	ExtensionFactory,
	SessionShutdownEvent,
	SessionStartEvent,
	TurnEndEvent,
	BeforeAgentStartEvent,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";

// These types exist in Pi's extension types but aren't re-exported from the main package
interface ToolExecutionStartEvent {
	type: "tool_execution_start";
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
}

interface ToolExecutionEndEvent {
	type: "tool_execution_end";
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean;
}

import fs from "node:fs";
import path from "node:path";
import { type Config, DIRS, readConfig } from "../config/index.js";
import { OPERATOR_PERSONA_PATH } from "../config/paths.js";
import { ECHOES_STATE_PATH } from "./scheduler/index.js";
import { validateChannelBinding } from "../gateway/binding-validator.js";
import { isOperatorTemplate, isPersonaTemplate } from "../init/persona-templates.js";
import { captureError } from "../ops/index.js";
import { appendJsonl } from "../utils/jsonl.js";
import { PERSONA_BOOTSTRAP_PROMPT, buildPersonaSystemPrompt } from "./persona-bootstrap.js";

/**
 * MyPensieve's main Pi extension factory.
 *
 * This extension is loaded by Pi's extension system from:
 *   ~/.pi/agent/extensions/mypensieve/index.ts
 *
 * It hooks into Pi's lifecycle events to provide:
 * - Session start: config validation, channel binding check
 * - Before agent start: inject persona/bootstrap into system prompt
 * - Turn end: capture decisions and thread updates for extraction
 * - Session shutdown: run the session-end extractor
 */
export function createMyPensieveExtension(overrides?: {
	configPath?: string;
	channelType?: "cli" | "telegram";
}): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		let config: Config | null = null;
		const channelType = overrides?.channelType ?? "cli";

		// --- Session Start ---
		pi.on("session_start", (_event: SessionStartEvent) => {
			try {
				config = readConfig(overrides?.configPath);
			} catch (err) {
				const e = err instanceof Error ? err : new Error(String(err));
				captureError({
					severity: "critical",
					errorType: "config_read",
					errorSrc: "extension:session_start",
					message: e.message,
					stack: e.stack,
					context: { channelType },
				});
				console.error("[mypensieve] Failed to load config:", e.message);
				return;
			}

			// Validate channel binding (fail-fast on invalid config)
			try {
				validateChannelBinding(channelType, config.channels);
			} catch (err) {
				const e = err instanceof Error ? err : new Error(String(err));
				captureError({
					severity: "critical",
					errorType: "channel_validation",
					errorSrc: "extension:session_start",
					message: e.message,
					stack: e.stack,
					context: { channelType },
				});
				console.error("[mypensieve] Channel binding validation failed:", e.message);
				return;
			}

			logSessionEvent("session_start", {
				channelType,
				operator: config.operator.name,
				timezone: config.operator.timezone,
			});
		});

		// --- System Prompt Injection (before_agent_start) ---
		// Fires before every LLM call. We append our persona/bootstrap to the system prompt.
		pi.on(
			"before_agent_start",
			(_event: BeforeAgentStartEvent, _ctx: ExtensionContext) => {
				if (!config) {
					// If session_start hasn't fired yet, try loading config now
					try {
						config = readConfig(overrides?.configPath);
					} catch {
						return;
					}
				}

				let personaBlock: string;

				if (config.agent_persona && !isPersonaTemplate()) {
					// Established persona - inject identity
					personaBlock = buildPersonaSystemPrompt(
						config.agent_persona.identity_prompt,
						config.operator.name,
					);
				} else {
					// No persona OR template-only - inject bootstrap prompt
					personaBlock = PERSONA_BOOTSTRAP_PROMPT;
				}

				// Append operator persona if filled in
				let operatorBlock = "";
				if (!isOperatorTemplate() && fs.existsSync(OPERATOR_PERSONA_PATH)) {
					const operatorPersona = fs.readFileSync(OPERATOR_PERSONA_PATH, "utf-8");
					operatorBlock = `\n\n[Operator Persona]\n${operatorPersona}`;
				}

				// Operational context
				const metaBlock = [
					`\n\n[MyPensieve Context]`,
					`Operator: ${config.operator.name}`,
					`Timezone: ${config.operator.timezone}`,
				].join("\n");

				// Active echoes - read live state from disk (updated by EchoScheduler)
				let echoBlock = "";
				try {
					if (fs.existsSync(ECHOES_STATE_PATH)) {
						const raw = fs.readFileSync(ECHOES_STATE_PATH, "utf-8");
						const echoes = JSON.parse(raw) as Array<{
							name: string;
							description: string;
							cron: string;
							nextRun: string | null;
						}>;
						if (echoes.length > 0) {
							const lines = echoes.map((e) => {
								const next = e.nextRun
									? new Date(e.nextRun).toLocaleString("en-IN", { timeZone: config!.operator.timezone })
									: "unknown";
								return `- ${e.name}: ${e.description} (next: ${next})`;
							});
							echoBlock = `\n\n[Active Echoes - your scheduled tasks]\n${lines.join("\n")}\nNote: These are YOUR internal scheduled tasks, not system cron. You can list, add, or remove them.`;
						}
					}
				} catch {
					// Non-critical - agent just won't see echoes this turn
				}

				const injection = `${personaBlock}${operatorBlock}${metaBlock}${echoBlock}`;

				// Append to Pi's existing system prompt
				return {
					systemPrompt: `${_event.systemPrompt}\n\n${injection}`,
				};
			},
		);

		// --- Tool Execution Logging ---
		// Logs what tools the agent calls (file reads, bash commands, etc.)
		// Written to disk only, never sent to Telegram chat.
		pi.on("tool_execution_start", (event: ToolExecutionStartEvent) => {
			const args = event.args ?? {};
			// Summarize args (avoid logging full file contents)
			let summary: string;
			switch (event.toolName) {
				case "read":
					summary = `path=${args.path ?? "?"}`;
					break;
				case "bash":
					summary = `cmd=${String(args.command ?? args.cmd ?? "?").slice(0, 100)}`;
					break;
				case "write":
				case "edit":
					summary = `path=${args.path ?? args.file_path ?? "?"}`;
					break;
				default:
					summary = JSON.stringify(args).slice(0, 100);
			}
			logToolEvent("tool_start", {
				channelType,
				tool: event.toolName,
				callId: event.toolCallId,
				summary,
			});
		});

		pi.on("tool_execution_end", (event: ToolExecutionEndEvent) => {
			logToolEvent("tool_end", {
				channelType,
				tool: event.toolName,
				callId: event.toolCallId,
				isError: event.isError,
			});
		});

		// --- Turn End ---
		pi.on("turn_end", (_event: TurnEndEvent) => {
			// Phase 3: Extract decisions and thread updates from this turn
			logSessionEvent("turn_end", { channelType });
		});

		// --- Session Shutdown ---
		pi.on("session_shutdown", (_event: SessionShutdownEvent) => {
			logSessionEvent("session_shutdown", { channelType });
		});
	};
}

/**
 * Log a session lifecycle event to the MyPensieve event log.
 */
function logSessionEvent(eventType: string, data: Record<string, unknown>): void {
	const logPath = path.join(DIRS.logs, "events", `${new Date().toISOString().slice(0, 10)}.jsonl`);
	appendJsonl(logPath, {
		timestamp: new Date().toISOString(),
		event: eventType,
		...data,
	});
}

/**
 * Log tool execution to a separate tool activity log.
 * This captures what the agent DID (file reads, bash commands, edits).
 * Written to disk only - never surfaced to Telegram chat.
 */
function logToolEvent(eventType: string, data: Record<string, unknown>): void {
	const logDir = path.join(DIRS.logs, "tools");
	const logPath = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
	appendJsonl(logPath, {
		timestamp: new Date().toISOString(),
		event: eventType,
		...data,
	});
}

/**
 * Default export for Pi's extension loader.
 * When Pi loads ~/.pi/agent/extensions/mypensieve/index.ts,
 * it calls the default export as an ExtensionFactory.
 */
export default createMyPensieveExtension();
