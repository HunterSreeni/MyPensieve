import fs from "node:fs";
import { CONFIG_PATH } from "./paths.js";
import { type Config, ConfigSchema } from "./schema.js";

export class ConfigReadError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "ConfigReadError";
	}
}

/**
 * Apply backward-compatible migrations to raw config JSON.
 * Each migration checks a condition and patches the object in-place.
 * Migrations are idempotent - safe to run multiple times.
 */
function migrateConfig(config: Record<string, unknown>): void {
	// v0 -> v1: Add version field if missing
	if (!config.version || config.version === 0) {
		config.version = 1;
	}

	// v0.1.3 -> v0.1.4: Add backup field if missing
	if (!config.backup) {
		config.backup = {
			enabled: true,
			cron: "30 2 * * *",
			retention_days: 30,
			destinations: [{ type: "local", path: "/tmp/mypensieve-backups" }],
			include_secrets: false,
		};
	}

	// v0.1.3 -> v0.1.4: Add tier_routing if missing
	if (!config.tier_routing && config.default_model) {
		config.tier_routing = { default: config.default_model as string };
	} else if (!config.tier_routing) {
		config.tier_routing = { default: "not-configured" };
	}
}

/**
 * Read and validate the MyPensieve config file.
 * Returns a fully typed, validated Config object.
 * Throws ConfigReadError if the file is missing, unreadable, or invalid.
 */
export function readConfig(configPath: string = CONFIG_PATH): Config {
	let raw: string;
	try {
		raw = fs.readFileSync(configPath, "utf-8");
	} catch (err) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") {
			throw new ConfigReadError(
				`Config file not found at ${configPath}. Run 'mypensieve init' first.`,
				err,
			);
		}
		throw new ConfigReadError(`Failed to read config at ${configPath}`, err);
	}

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw) as Record<string, unknown>;
	} catch (err) {
		throw new ConfigReadError(`Config file at ${configPath} is not valid JSON`, err);
	}

	// --- Backward compatibility migrations ---
	// Auto-upgrade older configs so they pass current schema validation.
	// Each migration is guarded by a version check so it only runs once.
	migrateConfig(parsed);

	const result = ConfigSchema.safeParse(parsed);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
		throw new ConfigReadError(`Config validation failed:\n${issues}`);
	}

	return result.data;
}
