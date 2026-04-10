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

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new ConfigReadError(`Config file at ${configPath} is not valid JSON`, err);
	}

	const result = ConfigSchema.safeParse(parsed);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
		throw new ConfigReadError(`Config validation failed:\n${issues}`);
	}

	return result.data;
}
