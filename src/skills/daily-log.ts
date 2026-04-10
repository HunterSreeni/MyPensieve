import path from "node:path";
import type { DailyDigest, DailyLogEntry } from "../memory/types.js";
import { appendJsonl, readJsonlSync } from "../utils/jsonl.js";
import type { SkillHandler } from "./executor.js";

/**
 * Daily-log skill (N7).
 * The single highest-leverage skill in MVP.
 *
 * Actions:
 * - write: Record a daily log entry (wins, blockers, mood, energy, etc.)
 * - read: Read a specific day's log entry
 * - trends: Query mood/energy trends over a period
 * - review: Generate a weekly review summary
 */
export const dailyLogHandler: SkillHandler = async (args, ctx) => {
	const action = args.action as string;
	const date = (args.date as string) ?? new Date().toISOString().slice(0, 10);
	const logPath = path.join(ctx.project.projectDir, "daily-logs.jsonl");

	switch (action) {
		case "write": {
			const entry = args.entry as Record<string, unknown> | undefined;
			if (!entry) {
				return { success: false, data: null, error: "Missing entry data for write action" };
			}

			// Build digest from current project state
			const digest = buildDigest(ctx);

			const logEntry: DailyLogEntry = {
				date,
				timestamp: new Date().toISOString(),
				project: ctx.project.binding,
				wins: (entry.wins as string[]) ?? [],
				blockers: (entry.blockers as string[]) ?? [],
				mood_score: (entry.mood_score as number) ?? 3,
				mood_text: (entry.mood_text as string) ?? "",
				energy_score: (entry.energy_score as number) ?? 3,
				energy_text: (entry.energy_text as string) ?? "",
				remember_tomorrow: (entry.remember_tomorrow as string) ?? "",
				weekly_review_flag: (entry.weekly_review_flag as boolean) ?? false,
				digest,
			};

			appendJsonl(logPath, logEntry);

			// Also index in SQLite
			ctx.project.index.indexDailyLog(logEntry);

			return { success: true, data: { date, stored: true } };
		}

		case "read": {
			const entries = readJsonlSync<DailyLogEntry>(logPath);
			const entry = entries.find((e) => e.date === date);
			if (!entry) {
				return { success: true, data: { date, found: false, message: `No log entry for ${date}` } };
			}
			return { success: true, data: entry };
		}

		case "trends": {
			const days = (args.days as number) ?? 30;
			const trends = ctx.project.index.queryMoodTrends({
				project: ctx.project.binding,
				days,
			});
			return { success: true, data: trends };
		}

		case "review": {
			const entries = readJsonlSync<DailyLogEntry>(logPath);
			const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
			const thisWeek = entries.filter((e) => e.date >= weekAgo);

			const allWins = thisWeek.flatMap((e) => e.wins);
			const allBlockers = thisWeek.flatMap((e) => e.blockers);
			const avgMood =
				thisWeek.length > 0
					? thisWeek.reduce((sum, e) => sum + e.mood_score, 0) / thisWeek.length
					: 0;
			const avgEnergy =
				thisWeek.length > 0
					? thisWeek.reduce((sum, e) => sum + e.energy_score, 0) / thisWeek.length
					: 0;

			return {
				success: true,
				data: {
					period: `${weekAgo} to ${new Date().toISOString().slice(0, 10)}`,
					days_logged: thisWeek.length,
					wins: allWins,
					blockers: allBlockers,
					avg_mood: Math.round(avgMood * 10) / 10,
					avg_energy: Math.round(avgEnergy * 10) / 10,
				},
			};
		}

		default:
			return { success: false, data: null, error: `Unknown journal action: ${action}` };
	}
};

function buildDigest(ctx: {
	project: {
		index: { getStats: () => { decisions: number; open_threads: number } };
		binding: string;
	};
}): DailyDigest {
	const stats = ctx.project.index.getStats();
	return {
		decisions_count: stats.decisions,
		open_threads_count: stats.open_threads,
		cost_summary: {},
		errors_count: 0,
		sessions_count: 1,
	};
}
