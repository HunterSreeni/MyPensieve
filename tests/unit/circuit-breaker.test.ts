import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker, CircuitBreakerRegistry } from "../../src/ops/errors/circuit-breaker.js";

describe("CircuitBreaker", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts closed and allows execution", () => {
		const cb = new CircuitBreaker("test");
		expect(cb.canExecute()).toBe(true);
		expect(cb.getState().status).toBe("closed");
	});

	it("stays closed below failure threshold", () => {
		const cb = new CircuitBreaker("test", { failureThreshold: 3 });
		cb.recordFailure();
		cb.recordFailure();
		expect(cb.canExecute()).toBe(true);
		expect(cb.getState().status).toBe("closed");
	});

	it("opens after reaching failure threshold", () => {
		const cb = new CircuitBreaker("test", { failureThreshold: 3 });
		cb.recordFailure();
		cb.recordFailure();
		cb.recordFailure();
		expect(cb.canExecute()).toBe(false);
		expect(cb.getState().status).toBe("open");
	});

	it("transitions to half-open after cooldown", () => {
		const cb = new CircuitBreaker("test", {
			failureThreshold: 2,
			cooldownMs: 5000,
		});
		cb.recordFailure();
		cb.recordFailure();
		expect(cb.getState().status).toBe("open");

		vi.advanceTimersByTime(5001);
		expect(cb.canExecute()).toBe(true);
		expect(cb.getState().status).toBe("half-open");
	});

	it("closes on success after half-open", () => {
		const cb = new CircuitBreaker("test", {
			failureThreshold: 2,
			cooldownMs: 1000,
		});
		cb.recordFailure();
		cb.recordFailure();

		vi.advanceTimersByTime(1001);
		cb.canExecute(); // triggers half-open
		cb.recordSuccess();

		expect(cb.getState().status).toBe("closed");
		expect(cb.getState().failure_count).toBe(0);
	});

	it("resets to closed on manual reset", () => {
		const cb = new CircuitBreaker("test", { failureThreshold: 1 });
		cb.recordFailure();
		expect(cb.getState().status).toBe("open");

		cb.reset();
		expect(cb.getState().status).toBe("closed");
		expect(cb.canExecute()).toBe(true);
	});

	it("success resets failure count while closed", () => {
		const cb = new CircuitBreaker("test", { failureThreshold: 3 });
		cb.recordFailure();
		cb.recordFailure();
		cb.recordSuccess();
		cb.recordFailure(); // should not trigger open (count reset)
		expect(cb.getState().status).toBe("closed");
	});
});

describe("CircuitBreakerRegistry", () => {
	it("creates breakers on demand", () => {
		const registry = new CircuitBreakerRegistry();
		const cb = registry.get("mcp:duckduckgo");
		expect(cb.canExecute()).toBe(true);
	});

	it("returns same breaker for same name", () => {
		const registry = new CircuitBreakerRegistry();
		const cb1 = registry.get("mcp:duckduckgo");
		const cb2 = registry.get("mcp:duckduckgo");
		cb1.recordFailure();
		expect(cb2.getState().failure_count).toBe(1);
	});

	it("lists all breakers", () => {
		const registry = new CircuitBreakerRegistry();
		registry.get("a");
		registry.get("b");
		expect(registry.getAll()).toHaveLength(2);
	});

	it("lists only open breakers", () => {
		const registry = new CircuitBreakerRegistry();
		const cb1 = registry.get("failing", { failureThreshold: 1 });
		registry.get("healthy");
		cb1.recordFailure();
		expect(registry.getOpen()).toHaveLength(1);
		expect(registry.getOpen()[0]?.name).toBe("failing");
	});

	it("resets breaker by name", () => {
		const registry = new CircuitBreakerRegistry();
		const cb = registry.get("test", { failureThreshold: 1 });
		cb.recordFailure();
		expect(registry.resetByName("test")).toBe(true);
		expect(cb.getState().status).toBe("closed");
	});

	it("returns false for unknown breaker name", () => {
		const registry = new CircuitBreakerRegistry();
		expect(registry.resetByName("nonexistent")).toBe(false);
	});
});
