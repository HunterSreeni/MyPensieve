import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../../config/paths.js";
import type { ErrorRecord } from "../../ops/errors/types.js";

/**
 * Display error log entries.
 */
export function runErrors(opts?: { severity?: string; date?: string }): void {
	const date = opts?.date ?? new Date().toISOString().slice(0, 10);
	const errorLogPath = path.join(DIRS.logsErrors, `${date}.jsonl`);

	if (!fs.existsSync(errorLogPath)) {
		console.log(`No errors for ${date}.`);
		return;
	}

	const lines = fs.readFileSync(errorLogPath, "utf-8").trim().split("\n").filter(Boolean);
	let entries: ErrorRecord[] = [];

	for (const line of lines) {
		try {
			entries.push(JSON.parse(line) as ErrorRecord);
		} catch {
			// Skip malformed lines
		}
	}

	// Filter by severity if specified
	if (opts?.severity) {
		entries = entries.filter((e) => e.severity === opts.severity);
	}

	if (entries.length === 0) {
		console.log(`No ${opts?.severity ? `${opts.severity} ` : ""}errors for ${date}.`);
		return;
	}

	console.log(`\nErrors for ${date} (${entries.length} total)\n`);

	for (const entry of entries) {
		const resolved = entry.resolved ? " [RESOLVED]" : "";
		const retries = entry.retry_count > 0 ? ` (${entry.retry_count} retries)` : "";
		console.log(
			`  [${entry.severity.toUpperCase().padEnd(8)}] ${entry.timestamp.slice(11, 19)} ${entry.error_src}: ${entry.message}${retries}${resolved}`,
		);
	}

	const unresolved = entries.filter((e) => !e.resolved).length;
	if (unresolved > 0) {
		console.log(`\n  ${unresolved} unresolved. Run 'mypensieve recover' to attempt auto-fix.`);
	}
}
