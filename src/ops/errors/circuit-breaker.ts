import type { CircuitBreakerState } from "./types.js";

const DEFAULT_COOLDOWN_MS = 60_000; // 1 minute
const DEFAULT_FAILURE_THRESHOLD = 5;

/**
 * Circuit breaker implementation.
 * States: closed (normal) -> open (failing, fast-fail) -> half-open (testing) -> closed
 */
export class CircuitBreaker {
	private state: CircuitBreakerState;
	private readonly failureThreshold: number;

	constructor(name: string, options?: { cooldownMs?: number; failureThreshold?: number }) {
		this.failureThreshold = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
		this.state = {
			name,
			status: "closed",
			failure_count: 0,
			last_failure: "",
			cooldown_ms: options?.cooldownMs ?? DEFAULT_COOLDOWN_MS,
		};
	}

	/** Check if a call should be allowed through */
	canExecute(): boolean {
		switch (this.state.status) {
			case "closed":
				return true;

			case "open": {
				// Check if cooldown has expired
				if (this.state.opened_at) {
					const elapsed = Date.now() - new Date(this.state.opened_at).getTime();
					if (elapsed >= this.state.cooldown_ms) {
						this.state.status = "half-open";
						this.state.half_open_at = new Date().toISOString();
						return true; // Allow one test call
					}
				}
				return false;
			}

			case "half-open":
				// Already allowing one test call
				return false;

			default:
				return false;
		}
	}

	/** Record a successful call */
	recordSuccess(): void {
		this.state.failure_count = 0;
		this.state.status = "closed";
	}

	/** Record a failed call */
	recordFailure(): void {
		this.state.failure_count++;
		this.state.last_failure = new Date().toISOString();

		if (this.state.failure_count >= this.failureThreshold) {
			this.state.status = "open";
			this.state.opened_at = new Date().toISOString();
		}
	}

	/** Get current state (for healthcheck/reporting) */
	getState(): Readonly<CircuitBreakerState> {
		return { ...this.state };
	}

	/** Force reset to closed (for recovery commands) */
	reset(): void {
		this.state.status = "closed";
		this.state.failure_count = 0;
	}
}

/**
 * Registry of circuit breakers by name.
 * Used by healthcheck and recovery commands.
 */
export class CircuitBreakerRegistry {
	private breakers = new Map<string, CircuitBreaker>();

	get(name: string, options?: { cooldownMs?: number; failureThreshold?: number }): CircuitBreaker {
		let breaker = this.breakers.get(name);
		if (!breaker) {
			breaker = new CircuitBreaker(name, options);
			this.breakers.set(name, breaker);
		}
		return breaker;
	}

	/** Get all breakers (for healthcheck) */
	getAll(): Array<{ name: string; state: CircuitBreakerState }> {
		return Array.from(this.breakers.entries()).map(([name, breaker]) => ({
			name,
			state: breaker.getState(),
		}));
	}

	/** Get all open breakers (for doctor warnings) */
	getOpen(): Array<{ name: string; state: CircuitBreakerState }> {
		return this.getAll().filter((b) => b.state.status === "open");
	}

	/** Reset a specific breaker by name */
	resetByName(name: string): boolean {
		const breaker = this.breakers.get(name);
		if (breaker) {
			breaker.reset();
			return true;
		}
		return false;
	}
}
