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

/**
 * Convert markdown to Telegram-compatible format.
 * Telegram supports a subset: bold, italic, code, links.
 */
export function toTelegramMarkdown(text: string): string {
	// Telegram uses MarkdownV2 - we keep it simple
	// Headers -> bold
	const result = text.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

	// Code blocks stay as-is (Telegram supports ```)
	// Inline code stays as-is (Telegram supports `)

	return result;
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
