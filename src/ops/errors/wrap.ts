import { captureError } from "./capture.js";
import type { Severity } from "./types.js";

export interface CaptureScope {
	/** Short identifier for the operation, e.g. "wizard:provider-probe". */
	errorSrc: string;
	/** Category, e.g. "init", "runtime", "network", "config". */
	errorType: string;
	/** How bad is this if it throws? */
	severity: Severity;
	/** Extra metadata to attach to the error record. */
	context?: Record<string, unknown>;
}

/**
 * Run an async operation, capture any thrown error into the structured error log,
 * then re-throw so callers can still handle or exit. Call this at operation
 * boundaries where you want a durable record - not on every line.
 *
 * Use `captureError` directly when you want to log a failure without throwing
 * (e.g. non-fatal warnings).
 */
export async function withCapture<T>(
	scope: CaptureScope,
	fn: () => Promise<T> | T,
): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: scope.severity,
			errorType: scope.errorType,
			errorSrc: scope.errorSrc,
			message: e.message,
			stack: e.stack,
			context: scope.context,
		});
		throw err;
	}
}

/**
 * Install process-level handlers that capture otherwise-unhandled errors into
 * the structured error log before the process dies. Install once at CLI entry.
 *
 * - uncaughtException: synchronous throws that escape the event loop
 * - unhandledRejection: promises that reject with no .catch()
 * - warning: node warnings (e.g. deprecation, memory) logged at severity "low"
 *
 * After capturing, we exit with code 1 for exceptions/rejections. Warnings are
 * logged but do not abort the process.
 */
export function installProcessErrorHandlers(): void {
	process.on("uncaughtException", (err) => {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "uncaught_exception",
			errorSrc: "process",
			message: e.message,
			stack: e.stack,
		});
		console.error("[mypensieve] Fatal: uncaught exception:", e.message);
		if (e.stack) console.error(e.stack);
		process.exit(1);
	});

	process.on("unhandledRejection", (reason) => {
		const e = reason instanceof Error ? reason : new Error(String(reason));
		captureError({
			severity: "critical",
			errorType: "unhandled_rejection",
			errorSrc: "process",
			message: e.message,
			stack: e.stack,
		});
		console.error("[mypensieve] Fatal: unhandled promise rejection:", e.message);
		if (e.stack) console.error(e.stack);
		process.exit(1);
	});

	process.on("warning", (warning) => {
		captureError({
			severity: "low",
			errorType: "node_warning",
			errorSrc: "process",
			message: warning.message,
			stack: warning.stack,
			context: { name: warning.name },
		});
	});
}
