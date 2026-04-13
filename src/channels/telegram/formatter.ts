import os from "node:os";

const TELEGRAM_MAX_LENGTH = 4096;
const HOME = os.homedir();

/**
 * Split a message into Telegram-compatible chunks (max 4096 chars).
 * Tries to split at newlines, then at spaces, then hard split.
 */
export function chunkMessage(text: string): string[] {
	if (text.length <= TELEGRAM_MAX_LENGTH) {
		return [text];
	}

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= TELEGRAM_MAX_LENGTH) {
			chunks.push(remaining);
			break;
		}

		// Try to split at last newline before limit
		let splitAt = remaining.lastIndexOf("\n", TELEGRAM_MAX_LENGTH);
		if (splitAt <= 0) {
			// Try space
			splitAt = remaining.lastIndexOf(" ", TELEGRAM_MAX_LENGTH);
		}
		if (splitAt <= 0) {
			// Hard split
			splitAt = TELEGRAM_MAX_LENGTH;
		}

		chunks.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).trimStart();
	}

	return chunks;
}

/** Characters that must be escaped in Telegram MarkdownV2 (outside code blocks). */
const MARKDOWNV2_SPECIAL = /([_*[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Escape special characters for Telegram MarkdownV2.
 * Preserves code blocks (``` ... ```) and inline code (` ... `) by
 * only escaping text outside of those regions.
 */
export function escapeMarkdownV2(text: string): string {
	// Split on code blocks and inline code, escape only non-code segments
	const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
	return parts
		.map((part, i) => {
			// Odd indices are code blocks/inline code - leave them as-is
			if (i % 2 === 1) return part;
			return part.replace(MARKDOWNV2_SPECIAL, "\\$1");
		})
		.join("");
}

/**
 * Convert markdown to Telegram-compatible MarkdownV2 format.
 * Escapes special characters and converts headers to bold.
 */
export function toTelegramMarkdown(text: string): string {
	// Escape first, then apply formatting (so bold * markers are not escaped)
	const escaped = escapeMarkdownV2(text);

	// Headers -> bold (# markers were escaped to \#, match sequences like \# or \#\#)
	return escaped.replace(/^(?:\\#){1,6}\s+(.+)$/gm, "*$1*");
}

/**
 * Sanitize agent output before sending to Telegram.
 * Redacts secrets that the agent may have read from allowed paths
 * (e.g. ~/.mypensieve/.secrets/) and echoed in its response.
 */
export function sanitizeOutput(text: string): string {
	return (
		text
			// Telegram bot tokens (numeric_id:alphanumeric_hash)
			.replace(/\d{8,}:[A-Za-z0-9_-]{30,}/g, "[BOT_TOKEN_REDACTED]")
			// OpenAI-style API keys
			.replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-[REDACTED]")
			// Generic API key patterns in JSON/config output
			.replace(
				/("(?:bot_token|api_key|secret_key|access_token|password|auth_token)")\s*:\s*"[^"]+"/gi,
				'$1: "[REDACTED]"',
			)
			// Bearer tokens
			.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/g, "Bearer [REDACTED]")
			// URLs with embedded credentials
			.replace(/:\/\/[^:/?#\s]+:[^@/?#\s]+@/g, "://[CREDENTIALS_REDACTED]@")
			// Full paths to secrets directory (don't leak structure in chat)
			.replace(
				new RegExp(
					`${HOME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.mypensieve/\\.secrets/[^\\s"]+`,
					"g",
				),
				"[SECRETS_PATH_REDACTED]",
			)
	);
}
