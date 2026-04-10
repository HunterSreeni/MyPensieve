import { z } from "zod";

// --- Operator profile ---

export const OperatorSchema = z.object({
	name: z.string().min(1),
	timezone: z.string().min(1), // IANA timezone e.g. "Asia/Kolkata"
	working_hours: z
		.object({
			start: z.string().regex(/^\d{2}:\d{2}$/), // "09:00"
			end: z.string().regex(/^\d{2}:\d{2}$/), // "18:00"
		})
		.optional(),
});

// --- Tier-hint routing ---

export const TierHintSchema = z.enum(["cheap", "mid", "deep"]);
export type TierHint = z.infer<typeof TierHintSchema>;

/**
 * Tier routing is the FALLBACK default when an agent doesn't have a direct model assignment.
 * Agents should specify their own `model: "provider/model"` field.
 * tier_routing.default is the model used when no agent-level or tier-level model is set.
 */
export const TierRoutingSchema = z.object({
	default: z.string().min(1), // fallback model for agents without explicit assignment
	cheap: z.string().min(1).optional(), // optional: operator can still use tiers if they want
	mid: z.string().min(1).optional(),
	deep: z.string().min(1).optional(),
});

// --- Embeddings ---

export const EmbeddingsSchema = z.object({
	enabled: z.boolean(),
	provider: z.string().optional(), // e.g. "ollama"
	model: z.string().optional(), // e.g. "nomic-embed-text"
	base_url: z.string().url().optional(),
});

// --- Daily log ---

export const DailyLogSchema = z.object({
	enabled: z.boolean(),
	cron: z.string().default("0 20 * * *"),
	channel: z.string().default("cli"),
	auto_prompt_next_morning_if_missed: z.boolean().default(true),
});

// --- Backup ---

export const BackupSchema = z.object({
	enabled: z.boolean(),
	cron: z.string().default("30 2 * * *"),
	retention_days: z.number().int().min(1).default(30),
	destinations: z.array(
		z.object({
			type: z.enum(["local", "rsync"]),
			path: z.string().min(1),
		}),
	),
	include_secrets: z.boolean().default(false),
});

// --- Channels ---

export const ChannelConfigSchema = z.object({
	enabled: z.boolean(),
	tool_escape_hatch: z.boolean().default(false),
});

export const TelegramChannelConfigSchema = ChannelConfigSchema.extend({
	// Telegram-specific: escape hatch is always false, enforced in validator
	tool_escape_hatch: z.literal(false).default(false),
	// Allowed Telegram user IDs. Empty = reject all. Operator must add their ID.
	allowed_peers: z.array(z.string()).default([]),
	// Disable group joins (BotFather /setjoingroups should also be disabled)
	allow_groups: z.boolean().default(false),
});

export const ChannelsSchema = z.object({
	cli: ChannelConfigSchema.default({ enabled: true, tool_escape_hatch: false }),
	telegram: TelegramChannelConfigSchema.default({
		enabled: false,
		tool_escape_hatch: false,
		allowed_peers: [],
		allow_groups: false,
	}),
});

// --- Nightly extractor ---

export const ExtractorSchema = z.object({
	cron: z.string().default("0 2 * * *"),
});

// --- Top-level config ---

export const ConfigSchema = z.object({
	version: z.literal(1),
	operator: OperatorSchema,
	tier_routing: TierRoutingSchema,
	embeddings: EmbeddingsSchema.default({ enabled: false }),
	daily_log: DailyLogSchema.default({
		enabled: true,
		cron: "0 20 * * *",
		channel: "cli",
		auto_prompt_next_morning_if_missed: true,
	}),
	backup: BackupSchema,
	channels: ChannelsSchema.default({}),
	extractor: ExtractorSchema.default({ cron: "0 2 * * *" }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Operator = z.infer<typeof OperatorSchema>;
export type TierRouting = z.infer<typeof TierRoutingSchema>;
export type Embeddings = z.infer<typeof EmbeddingsSchema>;
export type DailyLogConfig = z.infer<typeof DailyLogSchema>;
export type BackupConfig = z.infer<typeof BackupSchema>;
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;
export type Channels = z.infer<typeof ChannelsSchema>;
