import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	SessionShutdownEvent,
	SessionStartEvent,
	TurnEndEvent,
} from "@mariozechner/pi-coding-agent";

import path from "node:path";
import { type Config, DIRS, readConfig } from "../config/index.js";
import { validateChannelBinding } from "../gateway/binding-validator.js";
import { appendJsonl } from "../utils/jsonl.js";

/**
 * MyPensieve's main Pi extension factory.
 *
 * This extension is loaded by Pi's extension system from:
 *   ~/.pi/agent/extensions/mypensieve/index.ts
 *
 * It hooks into Pi's lifecycle events to provide:
 * - Session start: config validation, channel binding check, context injection
 * - Context: inject persona and memory summaries into the system prompt
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
				console.error(
					"[mypensieve] Failed to load config:",
					err instanceof Error ? err.message : String(err),
				);
				return;
			}

			// Validate channel binding (fail-fast on invalid config)
			try {
				validateChannelBinding(channelType, config.channels);
			} catch (err) {
				console.error(
					"[mypensieve] Channel binding validation failed:",
					err instanceof Error ? err.message : String(err),
				);
				return;
			}

			logSessionEvent("session_start", {
				channelType,
				operator: config.operator.name,
				timezone: config.operator.timezone,
			});
		});

		// --- Context Injection ---
		// The "context" event handler returns { messages } to inject into the conversation.
		// Phase 3 (memory) will flesh this out with persona and memory summaries.
		// Note: ContextEventResult is not exported from Pi's public API (Pi v0.66.1 oversight),
		// so we cast the handler. This will be cleaned up after Pi re-audit on 2026-04-13.
		(
			pi as unknown as {
				on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => void;
			}
		).on("context", (_event: unknown, _ctx: ExtensionContext) => {
			if (!config) return;

			const contextText = [
				`[MyPensieve] Operator: ${config.operator.name}`,
				`[MyPensieve] Timezone: ${config.operator.timezone}`,
				`[MyPensieve] Channel: ${channelType}`,
			].join("\n");

			return {
				messages: [
					{
						role: "system" as const,
						content: contextText,
					},
				],
			};
		});

		// --- Turn End ---
		pi.on("turn_end", (_event: TurnEndEvent) => {
			// Phase 3: Extract decisions and thread updates from this turn
			// For now, just log that a turn completed
			logSessionEvent("turn_end", { channelType });
		});

		// --- Session Shutdown ---
		pi.on("session_shutdown", (_event: SessionShutdownEvent) => {
			logSessionEvent("session_shutdown", { channelType });

			// Phase 3: Run the session-end extractor
			// Extract decisions, threads, persona deltas from the full session
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
 * Default export for Pi's extension loader.
 * When Pi loads ~/.pi/agent/extensions/mypensieve/index.ts,
 * it calls the default export as an ExtensionFactory.
 */
export default createMyPensieveExtension();
