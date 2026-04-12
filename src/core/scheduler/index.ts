/**
 * MyPensieve Echoes - internal scheduled tasks.
 *
 * "Echoes" are recurring tasks that repeat through time - the agent's own
 * scheduled actions (daily log, memory extraction, backups, reminders).
 * They are NOT system cron jobs. They run IN-PROCESS within the always-on
 * `mypensieve start` daemon. Fully cross-OS.
 *
 * The running process IS the scheduler. Echoes defined in config (daily_log.cron,
 * extractor.cron, backup.cron) are registered here and fire callbacks at the
 * specified times using the operator's configured timezone.
 *
 * Uses the `cron` package (v4+) which is pure JS, ESM-compatible, timezone-aware.
 */
import fs from "node:fs";
import path from "node:path";
import { CronJob } from "cron";
import { DIRS } from "../../config/paths.js";
import type { Config } from "../../config/schema.js";
import { captureError } from "../../ops/index.js";

/** Path to the echoes state file (read by the extension for prompt injection) */
export const ECHOES_STATE_PATH = path.join(DIRS.state, "echoes.json");

export interface Echo {
	name: string;
	description: string;
	cronExpression: string;
	timezone: string;
	job: CronJob;
}

export class EchoScheduler {
	private echoes = new Map<string, Echo>();
	private timezone: string;

	constructor(timezone: string) {
		this.timezone = timezone;
	}

	/**
	 * Register an echo. Replaces any existing echo with the same name.
	 */
	register(
		name: string,
		cronExpression: string,
		description: string,
		callback: () => void | Promise<void>,
	): void {
		// Remove existing if re-registering
		this.unregister(name);

		const job = CronJob.from({
			cronTime: cronExpression,
			onTick: async () => {
				try {
					await callback();
				} catch (err) {
					const e = err instanceof Error ? err : new Error(String(err));
					captureError({
						severity: "high",
						errorType: "echo_failed",
						errorSrc: `echoes:${name}`,
						message: e.message,
						stack: e.stack,
						context: { echo: name, cron: cronExpression },
					});
					console.error(`[echoes] '${name}' failed:`, e.message);
				}
			},
			start: true,
			timeZone: this.timezone,
		});

		this.echoes.set(name, {
			name,
			description,
			cronExpression,
			timezone: this.timezone,
			job,
		});

		console.log(`[echoes] Registered: ${name} (${cronExpression}) [${this.timezone}]`);
		this.persistState();
	}

	/**
	 * Unregister and stop an echo.
	 */
	unregister(name: string): void {
		const existing = this.echoes.get(name);
		if (existing) {
			existing.job.stop();
			this.echoes.delete(name);
			this.persistState();
		}
	}

	/**
	 * Persist current echo state to disk so the extension can read it.
	 */
	private persistState(): void {
		const state = this.list();
		try {
			fs.mkdirSync(path.dirname(ECHOES_STATE_PATH), { recursive: true });
			fs.writeFileSync(ECHOES_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
		} catch {
			// Non-critical - agent just won't see updated echoes until next persist
		}
	}

	/**
	 * Register all echoes from MyPensieve config.
	 * Called once at daemon startup.
	 */
	registerFromConfig(config: Config): void {
		// Daily log
		if (config.daily_log.enabled) {
			this.register(
				"daily-log",
				config.daily_log.cron,
				"Evening daily log prompt (6 questions)",
				() => {
					// v0.2.0: trigger the daily-log skill
					console.log("[echoes] Daily log triggered (skill not yet wired)");
				},
			);
		}

		// Memory extractor
		this.register(
			"extractor",
			config.extractor.cron,
			"Nightly memory extraction from sessions",
			() => {
				// v0.2.0: run the nightly memory extractor
				console.log("[echoes] Extractor triggered (not yet wired)");
			},
		);

		// Backup
		if (config.backup.enabled) {
			this.register("backup", config.backup.cron, "Automated backup of MyPensieve data", () => {
				// v0.2.0: run backup job
				console.log("[echoes] Backup triggered (not yet wired)");
			});
		}
	}

	/**
	 * Stop all echoes (for shutdown).
	 */
	stopAll(): void {
		for (const [, echo] of this.echoes) {
			echo.job.stop();
		}
		this.echoes.clear();
		this.persistState();
		console.log("[echoes] All stopped");
	}

	/**
	 * List registered echoes (for agent context injection and status display).
	 */
	list(): Array<{ name: string; description: string; cron: string; nextRun: Date | null }> {
		return Array.from(this.echoes.values()).map((e) => ({
			name: e.name,
			description: e.description,
			cron: e.cronExpression,
			nextRun: e.job.nextDate()?.toJSDate() ?? null,
		}));
	}

	/**
	 * Format echoes for system prompt injection so the agent knows what's scheduled.
	 */
	formatForPrompt(): string {
		const echoes = this.list();
		if (echoes.length === 0) return "[Active Echoes]\nNone scheduled.";

		const lines = echoes.map((e) => {
			const next = e.nextRun
				? e.nextRun.toLocaleString("en-IN", { timeZone: this.timezone })
				: "unknown";
			return `- ${e.name}: ${e.description} (next: ${next})`;
		});

		return `[Active Echoes]\n${lines.join("\n")}`;
	}
}
