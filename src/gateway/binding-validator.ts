import type { Channels } from "../config/schema.js";

export class BindingValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BindingValidationError";
	}
}

/**
 * Validate channel configuration at session start (fail-fast).
 * Throws BindingValidationError if the config is invalid.
 *
 * This is the enforcement point for:
 * - Telegram hard-block on tool() escape hatch
 * - Channel-specific skill restrictions
 */
export function validateChannelBinding(channelType: "cli" | "telegram", channels: Channels): void {
	const config = channels[channelType];

	if (!config.enabled) {
		throw new BindingValidationError(
			`Channel '${channelType}' is not enabled in config. Enable it via 'mypensieve config edit' or re-run 'mypensieve init'.`,
		);
	}

	// Hard-block: Telegram cannot have tool escape hatch
	if (channelType === "telegram" && config.tool_escape_hatch) {
		throw new BindingValidationError(
			"Security violation: tool() escape hatch cannot be enabled on Telegram channel. " +
				"This is a hard-block - Telegram sessions must use the 8-verb gateway only.",
		);
	}
}

/**
 * Check if the tool() escape hatch is allowed for this channel.
 */
export function isEscapeHatchAllowed(channelType: "cli" | "telegram", channels: Channels): boolean {
	if (channelType === "telegram") return false; // Hard-block, regardless of config
	return channels[channelType].tool_escape_hatch;
}
