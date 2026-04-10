import { z } from "zod";

// --- Recall ---

export const RecallArgsSchema = z.object({
	query: z.string().min(1),
	layers: z.array(z.enum(["decisions", "threads", "persona", "semantic", "raw"])).optional(),
	project: z.string().optional(), // defaults to current project
	since: z.string().optional(), // ISO date filter
	limit: z.number().int().positive().optional(),
});

export const RecallResultSchema = z.object({
	matches: z.array(
		z.object({
			layer: z.string(),
			content: z.string(),
			confidence: z.number().min(0).max(1),
			timestamp: z.string(),
			source: z.string().optional(),
		}),
	),
});

// --- Research ---

export const ResearchArgsSchema = z.object({
	topic: z.string().min(1),
	depth: z.enum(["quick", "standard", "deep"]).default("standard"),
	max_sources: z.number().int().positive().default(5),
});

export const ResearchResultSchema = z.object({
	synthesis: z.string(),
	citations: z.array(
		z.object({
			index: z.number().int(),
			url: z.string(),
			title: z.string(),
			accessed: z.string(), // ISO date
		}),
	),
	query_plan: z.array(z.string()),
});

// --- Ingest ---

export const IngestArgsSchema = z.object({
	source: z.string().min(1), // file path or URL
	source_type: z.enum(["file", "url", "audio", "video", "image"]).optional(), // auto-detect if omitted
	interactive: z.boolean().default(false), // use Playwright for interactive pages
});

export const IngestResultSchema = z.object({
	content: z.string(),
	source_type: z.string(),
	metadata: z.record(z.string()).optional(),
});

// --- Monitor ---

export const MonitorArgsSchema = z.object({
	target: z.enum(["cves", "packages", "github", "feeds", "cron", "backup"]),
	scope: z.string().optional(), // e.g. lockfile path, repo name, feed URL
});

export const MonitorResultSchema = z.object({
	deltas: z.array(
		z.object({
			id: z.string(),
			type: z.string(),
			summary: z.string(),
			severity: z.string().optional(),
			timestamp: z.string(),
			details: z.record(z.unknown()).optional(),
		}),
	),
	last_checked: z.string(),
});

// --- Journal ---

export const JournalArgsSchema = z.object({
	action: z.enum(["write", "read", "trends", "review"]),
	date: z.string().optional(), // ISO date, defaults to today
	entry: z
		.object({
			wins: z.array(z.string()).optional(),
			blockers: z.array(z.string()).optional(),
			mood_score: z.number().int().min(1).max(5).optional(),
			mood_text: z.string().optional(),
			energy_score: z.number().int().min(1).max(5).optional(),
			energy_text: z.string().optional(),
			remember_tomorrow: z.string().optional(),
			weekly_review_flag: z.boolean().optional(),
		})
		.optional(),
});

export const JournalResultSchema = z.object({
	action: z.string(),
	entry: z.record(z.unknown()).optional(),
	trends: z
		.object({
			avg_mood: z.number().optional(),
			avg_energy: z.number().optional(),
			period_days: z.number().optional(),
		})
		.optional(),
});

// --- Produce ---

export const ProduceArgsSchema = z.object({
	kind: z.enum(["blog-post", "image", "video", "audio", "text"]),
	prompt: z.string().min(1),
	output_path: z.string().optional(),
	options: z.record(z.unknown()).optional(),
});

export const ProduceResultSchema = z.object({
	kind: z.string(),
	output_path: z.string(),
	metadata: z.record(z.unknown()).optional(),
});

// --- Dispatch ---

export const DispatchArgsSchema = z.object({
	action: z.string().min(1), // e.g. "gh.pr.create", "git.commit", "git.push"
	params: z.record(z.unknown()).default({}),
	confirm: z.boolean().default(true), // require operator confirmation
});

export const DispatchResultSchema = z.object({
	action: z.string(),
	success: z.boolean(),
	output: z.string().optional(),
	url: z.string().optional(), // e.g. PR URL
});

// --- Notify ---

export const NotifyArgsSchema = z.object({
	message: z.string().min(1),
	severity: z.enum(["critical", "high", "medium", "low", "info"]).default("info"),
	channel: z.enum(["inline", "digest", "telegram"]).optional(), // auto-select based on severity
});

export const NotifyResultSchema = z.object({
	delivered: z.boolean(),
	channel: z.string(),
});

// --- Verb registry ---

export const VERB_NAMES = [
	"recall",
	"research",
	"ingest",
	"monitor",
	"journal",
	"produce",
	"dispatch",
	"notify",
] as const;

export type VerbName = (typeof VERB_NAMES)[number];

export const VERB_SCHEMAS = {
	recall: { args: RecallArgsSchema, result: RecallResultSchema },
	research: { args: ResearchArgsSchema, result: ResearchResultSchema },
	ingest: { args: IngestArgsSchema, result: IngestResultSchema },
	monitor: { args: MonitorArgsSchema, result: MonitorResultSchema },
	journal: { args: JournalArgsSchema, result: JournalResultSchema },
	produce: { args: ProduceArgsSchema, result: ProduceResultSchema },
	dispatch: { args: DispatchArgsSchema, result: DispatchResultSchema },
	notify: { args: NotifyArgsSchema, result: NotifyResultSchema },
} as const;

/** Read-side verbs (no persistent side effects) */
export const READ_VERBS: VerbName[] = ["recall", "research", "ingest", "monitor"];

/** Write-side verbs (have persistent side effects) */
export const WRITE_VERBS: VerbName[] = ["journal", "produce", "dispatch", "notify"];

/** The one verb that uses LLM routing instead of deterministic */
export const LLM_ROUTED_VERB: VerbName = "research";
