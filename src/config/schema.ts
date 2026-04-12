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
 * Tier routing is the LEGACY fallback layer kept for back-compat with older configs.
 * Primary routing is `default_model` + optional `agent_models`. Tier routing is only
 * consulted when neither is set.
 */
export const TierRoutingSchema = z.object({
	default: z.string().min(1),
	cheap: z.string().min(1).optional(),
	mid: z.string().min(1).optional(),
	deep: z.string().min(1).optional(),
});

// --- Persona seeding mode ---

export const PersonaModeSchema = z.enum(["questionnaire", "freeform", "skip"]);
export type PersonaMode = z.infer<typeof PersonaModeSchema>;

// --- Agent persona (identity injection) ---

export const AgentPersonaSchema = z.object({
	/** Display name of the agent (e.g. "Pensieve", "Jarvis") */
	name: z.string().min(1),
	/** The full identity prompt injected as a system message on every session */
	identity_prompt: z.string().min(1),
	/** When the persona was created/last updated (ISO string) */
	created_at: z.string().optional(),
});

export type AgentPersona = z.infer<typeof AgentPersonaSchema>;

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
	/**
	 * Primary default model in "provider/modelId" format.
	 * When set, takes priority over `tier_routing.default`.
	 */
	default_model: z.string().min(1).optional(),
	/**
	 * Optional per-agent model overrides keyed by agent name.
	 * Each value is a "provider/modelId" string.
	 */
	agent_models: z.record(z.string().min(1), z.string().min(1)).optional(),
	/** Persona seeding mode chosen during init. */
	persona_mode: PersonaModeSchema.optional(),
	/** Agent identity - injected as system prompt on every session. */
	agent_persona: AgentPersonaSchema.optional(),
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

/**
 * Resolve the effective default model for a config.
 * Priority: default_model → tier_routing.default.
 * Throws if neither is usable.
 */
export function resolveDefaultModel(config: Config): string {
	const m = config.default_model ?? config.tier_routing.default;
	if (!m || m === "not-configured") {
		throw new Error(
			"No default model configured. Run 'mypensieve init --restart' to set one.",
		);
	}
	return m;
}

/**
 * Parse a "provider/modelId" string into its parts.
 * Model IDs may contain slashes themselves; only the first slash is treated as the separator.
 */
export function parseModelString(s: string): { provider: string; modelId: string } {
	const i = s.indexOf("/");
	if (i <= 0 || i === s.length - 1) {
		throw new Error(`Invalid model string '${s}'. Expected 'provider/modelId'.`);
	}
	return { provider: s.slice(0, i), modelId: s.slice(i + 1) };
}
export type Embeddings = z.infer<typeof EmbeddingsSchema>;
export type DailyLogConfig = z.infer<typeof DailyLogSchema>;
export type BackupConfig = z.infer<typeof BackupSchema>;
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;
export type Channels = z.infer<typeof ChannelsSchema>;
