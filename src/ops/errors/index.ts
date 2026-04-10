export {
	type ErrorRecord,
	type CircuitBreakerState,
	type RetryPolicy,
	type Severity,
	SEVERITY_LEVELS,
	DEFAULT_RETRY_POLICIES,
} from "./types.js";
export { ErrorDedup } from "./dedup.js";
export { CircuitBreaker, CircuitBreakerRegistry } from "./circuit-breaker.js";
