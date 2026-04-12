export {
	type ErrorRecord,
	type Severity,
	SEVERITY_LEVELS,
	DEFAULT_RETRY_POLICIES,
} from "./errors/types.js";
export { ErrorDedup } from "./errors/dedup.js";
export { CircuitBreaker, CircuitBreakerRegistry } from "./errors/circuit-breaker.js";
export { captureError, resolveError } from "./errors/capture.js";
export { withCapture, installProcessErrorHandlers, type CaptureScope } from "./errors/wrap.js";
export { createBackup, verifyBackup, pruneBackups, type BackupResult } from "./backup/engine.js";
export { logCost, readDailyCost, type CostEntry, type DailyCostSummary } from "./cost.js";
