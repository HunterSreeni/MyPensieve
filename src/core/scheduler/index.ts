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
/** Pending daily-log reminders surfaced to the operator on next session. */
export const DAILY_LOG_REMINDERS_PATH = path.join(DIRS.state, "daily-log-reminders.jsonl");
/** Echo run log - every echo firing records here for audit / agent awareness. */
export const ECHO_EVENTS_PATH = path.join(DIRS.state, "echo-events.jsonl");

function appendEchoEvent(name: string, data: Record<string, unknown>): void {
	try {
		fs.mkdirSync(path.dirname(ECHO_EVENTS_PATH), { recursive: true });
		fs.appendFileSync(
			ECHO_EVENTS_PATH,
			`${JSON.stringify({ timestamp: new Date().toISOString(), echo: name, ...data })}\n`,
			"utf-8",
		);
	} catch {
		// Non-critical - echo already ran successfully.
	}
}

function writeDailyLogReminder(channel: string): void {
	try {
		fs.mkdirSync(path.dirname(DAILY_LOG_REMINDERS_PATH), { recursive: true });
		fs.appendFileSync(
			DAILY_LOG_REMINDERS_PATH,
			`${JSON.stringify({
				timestamp: new Date().toISOString(),
				date: new Date().toISOString().slice(0, 10),
				channel,
				status: "pending",
			})}\n`,
			"utf-8",
		);
		console.log(`[echoes] daily-log: reminder queued for ${channel}`);
		appendEchoEvent("daily-log", { channel, status: "reminder_queued" });
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		throw new Error(`failed to write daily-log reminder: ${e.message}`);
	}
}

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
		// Daily log - writes a pending reminder for the next operator interaction.
		// We don't invoke the daily-log skill directly because it needs a skill
		// context (project binding, index) that only exists inside a live session.
		if (config.daily_log.enabled) {
			this.register(
				"daily-log",
				config.daily_log.cron,
				"Evening daily log prompt (6 questions)",
				() => {
					writeDailyLogReminder(config.daily_log.channel);
				},
			);
		}

		// Memory extractor
		this.register(
			"extractor",
			config.extractor.cron,
			"Nightly memory extraction from sessions",
			async () => {
				const { runExtraction } = await import("../../memory/extractor.js");
				const result = await runExtraction({ config });
				console.log(
					`[echoes] extractor: ${result.processedSessions} sessions, ${result.decisionsAdded} decisions, ${result.threadsAdded} threads, ${result.personaDeltasAdded} persona-deltas${result.failures.length ? `, ${result.failures.length} failures` : ""}`,
				);
				appendEchoEvent("extractor", {
					processed: result.processedSessions,
					skipped: result.skippedSessions,
					decisions: result.decisionsAdded,
					threads: result.threadsAdded,
					persona_deltas: result.personaDeltasAdded,
					failures: result.failures.length,
				});

				// Optional post-step: report-only synthesizer pass.
				if (config.extractor.synthesize_after) {
					const { runSynthesis, formatSynthesisReport } = await import(
						"../../memory/synthesizer-runner.js"
					);
					const synth = runSynthesis({ apply: false });
					console.log(`[echoes] ${formatSynthesisReport(synth).split("\n")[0]}`);
					appendEchoEvent("synthesize", {
						projects: synth.projects_scanned,
						decisions_before: synth.total_decisions_before,
						duplicates_found: synth.total_duplicates_removed,
						deltas_pending: synth.per_project.reduce(
							(sum, p) => sum + p.persona.applied_ids.length,
							0,
						),
					});
				}
			},
		);

		// Backup
		if (config.backup.enabled) {
			this.register(
				"backup",
				config.backup.cron,
				"Automated backup of MyPensieve data",
				async () => {
					const { createBackup, verifyBackup, pruneBackups } = await import(
						"../../ops/backup/engine.js"
					);
					const result = createBackup(config.backup);
					if (!result.success || !result.archivePath) {
						throw new Error(result.error ?? "backup failed with no archive path");
					}
					const verified = verifyBackup(result.archivePath);
					if (!verified.valid) {
						throw new Error(verified.error ?? "backup archive failed verification");
					}
					let totalPruned = 0;
					for (const dest of config.backup.destinations) {
						totalPruned += pruneBackups(dest.path, config.backup.retention_days);
					}
					console.log(
						`[echoes] backup: ${result.archivePath} (${result.sizeBytes} bytes, ${result.duration_ms}ms), pruned ${totalPruned}`,
					);
					appendEchoEvent("backup", {
						archive: result.archivePath,
						size_bytes: result.sizeBytes,
						duration_ms: result.duration_ms,
						pruned: totalPruned,
					});
				},
			);
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
