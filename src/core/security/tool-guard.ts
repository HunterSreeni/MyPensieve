/**
 * Pi Agent beforeToolCall hook that enforces filesystem guardrails.
 *
 * Intercepts read/write/edit/bash tool calls and checks them against
 * the security policy before allowing execution.
 */
import type { BeforeToolCallContext, BeforeToolCallResult } from "@mariozechner/pi-agent-core";
import { captureError } from "../../ops/index.js";
import { checkBashCommand, checkReadAccess, checkWriteAccess } from "./guardrails.js";

/**
 * Create a beforeToolCall guard for the given working directory.
 */
export function createToolGuard(cwd: string) {
	return async (context: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
		const toolName = context.toolCall.name;
		const args = context.toolCall.arguments as Record<string, unknown>;

		switch (toolName) {
			case "read": {
				const filePath = args.path as string | undefined;
				if (!filePath) return undefined;
				const result = checkReadAccess(filePath);
				if (!result.allowed) {
					logDenial(toolName, filePath, result.reason ?? "");
					return { block: true, reason: result.reason };
				}
				break;
			}

			case "write":
			case "edit": {
				const filePath = (args.path ?? args.file_path) as string | undefined;
				if (!filePath) return undefined;

				// Check read access too (edit reads first)
				if (toolName === "edit") {
					const readResult = checkReadAccess(filePath);
					if (!readResult.allowed) {
						logDenial(toolName, filePath, readResult.reason ?? "");
						return { block: true, reason: readResult.reason };
					}
				}

				const writeResult = checkWriteAccess(filePath, cwd);
				if (!writeResult.allowed) {
					logDenial(toolName, filePath, writeResult.reason ?? "");
					return { block: true, reason: writeResult.reason };
				}
				break;
			}

			case "bash": {
				const command = (args.command ?? args.cmd) as string | undefined;
				if (!command) return undefined;
				const result = checkBashCommand(command, cwd);
				if (!result.allowed) {
					logDenial(toolName, command.slice(0, 100), result.reason ?? "");
					return { block: true, reason: result.reason };
				}
				break;
			}
		}

		return undefined; // Allow by default
	};
}

function logDenial(tool: string, target: string, reason: string): void {
	captureError({
		severity: "medium",
		errorType: "security_guardrail",
		errorSrc: "security:tool-guard",
		message: `Blocked ${tool} call: ${reason}`,
		context: { tool, target: target.slice(0, 200) },
	});
}
