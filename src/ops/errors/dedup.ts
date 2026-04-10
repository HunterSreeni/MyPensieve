import type { ErrorRecord } from "./types.js";

interface DedupEntry {
	first_seen: number; // epoch ms
	count: number;
	last_record: ErrorRecord;
}

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Error notification deduplicator.
 * Deduplicates by (error_type, error_src) within a 1-hour window.
 * All occurrences are logged, but only the first surfaces to the operator.
 */
export class ErrorDedup {
	private windows = new Map<string, DedupEntry>();

	private key(errorType: string, errorSrc: string): string {
		return `${errorType}:${errorSrc}`;
	}

	/**
	 * Record an error and decide whether to surface it.
	 * Returns { shouldSurface, count } where:
	 * - shouldSurface=true for the first occurrence in a window
	 * - count is the total occurrences in the current window
	 */
	record(record: ErrorRecord): { shouldSurface: boolean; count: number } {
		const k = this.key(record.error_type, record.error_src);
		const now = Date.now();

		const existing = this.windows.get(k);

		if (existing && now - existing.first_seen < WINDOW_MS) {
			// Within window - suppress but count
			existing.count++;
			existing.last_record = record;
			return { shouldSurface: false, count: existing.count };
		}

		// New window or expired window
		this.windows.set(k, { first_seen: now, count: 1, last_record: record });
		return { shouldSurface: true, count: 1 };
	}

	/**
	 * Get a summary of suppressed errors for surfacing in digests.
	 * Returns entries that had more than 1 occurrence in their window.
	 */
	getSuppressedSummaries(): Array<{
		error_type: string;
		error_src: string;
		count: number;
		first_seen: string;
		last_message: string;
	}> {
		const summaries: Array<{
			error_type: string;
			error_src: string;
			count: number;
			first_seen: string;
			last_message: string;
		}> = [];

		for (const [, entry] of this.windows) {
			if (entry.count > 1) {
				summaries.push({
					error_type: entry.last_record.error_type,
					error_src: entry.last_record.error_src,
					count: entry.count,
					first_seen: new Date(entry.first_seen).toISOString(),
					last_message: entry.last_record.message,
				});
			}
		}

		return summaries;
	}

	/**
	 * Clear expired windows.
	 * Call periodically to prevent memory growth.
	 */
	prune(): number {
		const now = Date.now();
		let pruned = 0;

		for (const [key, entry] of this.windows) {
			if (now - entry.first_seen >= WINDOW_MS) {
				this.windows.delete(key);
				pruned++;
			}
		}

		return pruned;
	}

	/** Reset all windows (for testing) */
	clear(): void {
		this.windows.clear();
	}
}
