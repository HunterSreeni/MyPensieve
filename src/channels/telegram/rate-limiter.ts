/**
 * Per-peer rate limiter for Telegram messages.
 * Sliding window: tracks message timestamps and rejects if count exceeds limit.
 */

export interface RateLimiterConfig {
	/** Max messages per peer within the window. Default: 10 */
	maxMessages: number;
	/** Window size in milliseconds. Default: 60_000 (1 minute) */
	windowMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
	maxMessages: 10,
	windowMs: 60_000,
};

export class PeerRateLimiter {
	private windows: Map<string, number[]> = new Map();
	private config: RateLimiterConfig;

	constructor(config?: Partial<RateLimiterConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Check if a peer is allowed to send a message.
	 * Returns true if allowed, false if rate-limited.
	 */
	check(peerId: string): boolean {
		const now = Date.now();
		const cutoff = now - this.config.windowMs;

		let timestamps = this.windows.get(peerId);
		if (!timestamps) {
			timestamps = [];
			this.windows.set(peerId, timestamps);
		}

		// Evict expired entries
		const valid = timestamps.filter((t) => t > cutoff);
		this.windows.set(peerId, valid);

		if (valid.length >= this.config.maxMessages) {
			return false;
		}

		valid.push(now);
		return true;
	}

	/** Clear all tracked state (for shutdown). */
	clear(): void {
		this.windows.clear();
	}
}
