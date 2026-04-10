import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_PATH } from "./paths.js";
import { type Config, ConfigSchema } from "./schema.js";

export class ConfigWriteError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "ConfigWriteError";
	}
}

/**
 * Write config atomically: write to temp file, then rename.
 * Sets mode 0444 (read-only) after write.
 * Only used by `mypensieve init` and `mypensieve config edit`.
 *
 * Validates the config before writing - will not write invalid config.
 */
export function writeConfig(config: Config, configPath: string = CONFIG_PATH): void {
	// Validate before writing
	const result = ConfigSchema.safeParse(config);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
		throw new ConfigWriteError(`Refusing to write invalid config:\n${issues}`);
	}

	const dir = path.dirname(configPath);
	const tmpPath = path.join(dir, `.config-${crypto.randomUUID()}.tmp`);

	try {
		// Ensure directory exists
		fs.mkdirSync(dir, { recursive: true });

		// If existing config is read-only, temporarily make it writable for rename
		try {
			fs.chmodSync(configPath, 0o644);
		} catch {
			// File might not exist yet, that's fine
		}

		// Write to temp file
		fs.writeFileSync(tmpPath, `${JSON.stringify(result.data, null, 2)}\n`, "utf-8");

		// Atomic rename
		fs.renameSync(tmpPath, configPath);

		// Set read-only
		fs.chmodSync(configPath, 0o444);
	} catch (err) {
		// Clean up temp file on failure
		try {
			fs.unlinkSync(tmpPath);
		} catch {
			// Ignore cleanup errors
		}

		if (err instanceof ConfigWriteError) throw err;
		throw new ConfigWriteError(`Failed to write config to ${configPath}`, err);
	}
}
