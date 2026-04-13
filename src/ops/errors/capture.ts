import crypto from "node:crypto";
import path from "node:path";
import { DIRS } from "../../config/paths.js";
import { appendJsonl } from "../../utils/jsonl.js";
import { ErrorDedup } from "./dedup.js";
import type { ErrorRecord, Severity } from "./types.js";

const dedup = new ErrorDedup();

/**
 * True when running under vitest. We avoid writing to the operator's real
 * error log during test runs so tests that exercise error paths don't
 * pollute ~/.mypensieve/logs/errors/ or poison dedup state across runs.
 * Tests that need to verify captureError behavior should import from
 * capture.ts directly and use the returned record.
 */
const isTestEnv =
	process.env.VITEST === "true" ||
	process.env.NODE_ENV === "test" ||
	process.env.MYPENSIEVE_DISABLE_ERROR_LOG === "1";

/**
 * Capture an error into the structured error log.
 * Returns { surfaced } indicating whether this error was surfaced to the operator
 * (vs suppressed by dedup).
 */
export function captureError(opts: {
	severity: Severity;
	errorType: string;
	errorSrc: string;
	message: string;
	stack?: string;
	context?: Record<string, unknown>;
}): { surfaced: boolean; record: ErrorRecord } {
	const record: ErrorRecord = {
		id: `err-${crypto.randomUUID()}`,
		timestamp: new Date().toISOString(),
		severity: opts.severity,
		error_type: opts.errorType,
		error_src: opts.errorSrc,
		message: redactSecrets(opts.message),
		stack: opts.stack ? redactSecrets(opts.stack) : undefined,
		context: opts.context ?? {},
		resolved: false,
		retry_count: 0,
	};

	// Log to disk unless running under vitest (see isTestEnv above).
	if (!isTestEnv) {
		const date = record.timestamp.slice(0, 10);
		const logPath = path.join(DIRS.logsErrors, `${date}.jsonl`);
		appendJsonl(logPath, record);
	}

	// Check dedup (run in-memory even under tests so dedup logic stays testable)
	const { shouldSurface } = dedup.record(record);

	return { surfaced: shouldSurface, record };
}

/**
 * Mark an error as resolved.
 */
export function resolveError(
	errorId: string,
	resolvedBy: "auto_retry" | "circuit_breaker" | "operator" | "recovery_command",
): void {
	// In a full implementation, this would update the JSONL entry
	// For MVP, we log the resolution as a new entry
	const date = new Date().toISOString().slice(0, 10);
	const logPath = path.join(DIRS.logsErrors, `${date}.jsonl`);
	appendJsonl(logPath, {
		type: "resolution",
		error_id: errorId,
		resolved_by: resolvedBy,
		timestamp: new Date().toISOString(),
	});
}

/**
 * Redact potential secrets from error messages.
 * Catches common patterns: API keys, tokens, passwords, URLs with creds, bot tokens.
 */
export function redactSecrets(text: string): string {
	return (
		text
			// Bearer tokens (must run before the generic key=value pattern)
			.replace(/Bearer\s+\S+/g, "Bearer [REDACTED]")
			// Key=value patterns (api_key=xxx, token: xxx, password=xxx, etc.)
			.replace(/(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*\S+/gi, (match) =>
				match.replace(/[:=]\s*\S+/, ": [REDACTED]"),
			)
			// OpenAI-style keys
			.replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-[REDACTED]")
			// Telegram bot tokens (numeric_id:alphanumeric)
			.replace(/\d{8,}:[A-Za-z0-9_-]{30,}/g, "[BOT_TOKEN_REDACTED]")
			// URLs with embedded credentials (http://user:pass@host)
			.replace(/:\/\/[^:/?#\s]+:[^@/?#\s]+@/g, "://[CREDENTIALS_REDACTED]@")
			// Custom auth headers (X-API-Key, X-Auth-Token, etc.)
			.replace(/X-(?:API|Auth)[_-](?:Key|Token)\s*:\s*\S+/gi, (match) =>
				match.replace(/:\s*\S+/, ": [REDACTED]"),
			)
	);
}
