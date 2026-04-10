const TELEGRAM_MAX_LENGTH = 4096;

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
