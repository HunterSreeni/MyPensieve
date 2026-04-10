import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorDedup } from "../../src/ops/errors/dedup.js";
import type { ErrorRecord } from "../../src/ops/errors/types.js";

function makeError(overrides?: Partial<ErrorRecord>): ErrorRecord {
	return {
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		severity: "medium",
		error_type: "network",
		error_src: "duckduckgo-search",
		message: "Connection timeout",
		context: {},
		resolved: false,
		retry_count: 0,
		...overrides,
	};
}

describe("ErrorDedup", () => {
	let dedup: ErrorDedup;

	beforeEach(() => {
		dedup = new ErrorDedup();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("surfaces the first occurrence", () => {
		const result = dedup.record(makeError());
		expect(result.shouldSurface).toBe(true);
		expect(result.count).toBe(1);
	});

	it("suppresses subsequent occurrences within window", () => {
		dedup.record(makeError());
		const result2 = dedup.record(makeError());
		expect(result2.shouldSurface).toBe(false);
		expect(result2.count).toBe(2);

		const result3 = dedup.record(makeError());
		expect(result3.shouldSurface).toBe(false);
		expect(result3.count).toBe(3);
	});

	it("surfaces again after window expires", () => {
		dedup.record(makeError());
		dedup.record(makeError());

		// Advance past 1-hour window
		vi.advanceTimersByTime(61 * 60 * 1000);

		const result = dedup.record(makeError());
		expect(result.shouldSurface).toBe(true);
		expect(result.count).toBe(1);
	});

	it("tracks different error types independently", () => {
		dedup.record(makeError({ error_type: "network", error_src: "duckduckgo" }));
		const result = dedup.record(makeError({ error_type: "rate_limit", error_src: "openrouter" }));
		expect(result.shouldSurface).toBe(true);
		expect(result.count).toBe(1);
	});

	it("tracks different sources independently", () => {
		dedup.record(makeError({ error_type: "network", error_src: "mcp-a" }));
		const result = dedup.record(makeError({ error_type: "network", error_src: "mcp-b" }));
		expect(result.shouldSurface).toBe(true);
	});

	it("returns suppressed summaries", () => {
		dedup.record(makeError());
		dedup.record(makeError());
		dedup.record(makeError());

		const summaries = dedup.getSuppressedSummaries();
		expect(summaries).toHaveLength(1);
		expect(summaries[0]?.count).toBe(3);
		expect(summaries[0]?.error_type).toBe("network");
		expect(summaries[0]?.error_src).toBe("duckduckgo-search");
	});

	it("prunes expired windows", () => {
		dedup.record(makeError());

		vi.advanceTimersByTime(61 * 60 * 1000);
		const pruned = dedup.prune();
		expect(pruned).toBe(1);

		// After prune, new record surfaces
		const result = dedup.record(makeError());
		expect(result.shouldSurface).toBe(true);
	});

	it("clear resets all state", () => {
		dedup.record(makeError());
		dedup.record(makeError());
		dedup.clear();

		const result = dedup.record(makeError());
		expect(result.shouldSurface).toBe(true);
		expect(result.count).toBe(1);
	});
});
