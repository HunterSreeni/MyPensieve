export const SEVERITY_LEVELS = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITY_LEVELS)[number];

export interface ErrorRecord {
	id: string;
	timestamp: string; // ISO
	severity: Severity;
	error_type: string; // e.g. "network", "rate_limit", "oauth", "mcp_crash", "extension"
	error_src: string; // e.g. "duckduckgo-search", "cve-intel", "memory-extractor"
	message: string;
	stack?: string;
	context: Record<string, unknown>;
	resolved: boolean;
	resolved_at?: string;
	resolved_by?: "auto_retry" | "circuit_breaker" | "operator" | "recovery_command";
	retry_count: number;
}

export interface CircuitBreakerState {
	name: string; // e.g. "mcp:duckduckgo-search", "provider:openrouter"
	status: "closed" | "open" | "half-open";
	failure_count: number;
	last_failure: string; // ISO
	opened_at?: string; // ISO
	cooldown_ms: number;
	half_open_at?: string; // ISO
}

export interface RetryPolicy {
	error_type: string;
	max_retries: number;
	backoff_base_ms: number; // exponential backoff base
	backoff_max_ms: number;
}

export const DEFAULT_RETRY_POLICIES: RetryPolicy[] = [
	{ error_type: "network", max_retries: 3, backoff_base_ms: 1000, backoff_max_ms: 30_000 },
	{ error_type: "rate_limit", max_retries: 5, backoff_base_ms: 2000, backoff_max_ms: 60_000 },
	{ error_type: "oauth", max_retries: 2, backoff_base_ms: 5000, backoff_max_ms: 30_000 },
	{ error_type: "mcp_crash", max_retries: 3, backoff_base_ms: 3000, backoff_max_ms: 30_000 },
];
