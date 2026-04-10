import path from "node:path";
import { DIRS } from "../config/paths.js";
import { appendJsonl } from "../utils/jsonl.js";
import type { VerbName } from "./verbs.js";

export interface AuditEntry {
	timestamp: string;
	verb: VerbName;
	target: string;
	target_type: "skill" | "mcp" | "extension";
	rule_name: string;
	channel: string;
	project: string;
	success: boolean;
	duration_ms: number;
	error?: string;
}

/**
 * Log a verb invocation to the audit log.
 * Audit log lives at ~/.mypensieve/logs/audit/<date>.jsonl
 */
export function logAudit(entry: AuditEntry): void {
	const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
	const auditPath = path.join(DIRS.logs, "audit", `${date}.jsonl`);
	appendJsonl(auditPath, entry);
}

/**
 * Create an audit entry with timing.
 * Usage:
 *   const audit = startAudit("recall", "memory-recall", "skill", "default", "cli", "myproject");
 *   try { ... audit.succeed(); } catch (e) { audit.fail(e); }
 */
export function startAudit(
	verb: VerbName,
	target: string,
	targetType: "skill" | "mcp" | "extension",
	ruleName: string,
	channel: string,
	project: string,
): { succeed: () => void; fail: (error: unknown) => void } {
	const startTime = Date.now();
	const timestamp = new Date().toISOString();

	return {
		succeed() {
			logAudit({
				timestamp,
				verb,
				target,
				target_type: targetType,
				rule_name: ruleName,
				channel,
				project,
				success: true,
				duration_ms: Date.now() - startTime,
			});
		},
		fail(error: unknown) {
			logAudit({
				timestamp,
				verb,
				target,
				target_type: targetType,
				rule_name: ruleName,
				channel,
				project,
				success: false,
				duration_ms: Date.now() - startTime,
				error: error instanceof Error ? error.message : String(error),
			});
		},
	};
}
