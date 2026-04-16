import fs from "node:fs";
import path from "node:path";
import { SECRETS_DIR } from "../config/paths.js";

/**
 * Read the API key for a provider from ~/.mypensieve/.secrets/{provider}.json.
 * The file must contain a JSON object with an `api_key` string field.
 *
 * Checks directory (0700) and file (0600) permissions, warns if wrong.
 * Throws if the file is missing or the api_key field is absent/empty.
 */
export function readProviderApiKey(provider: string): string {
	const secretsPath = path.join(SECRETS_DIR, `${provider}.json`);

	if (!fs.existsSync(secretsPath)) {
		throw new Error(
			`API key not found for provider '${provider}' at ${secretsPath}.\nRun 'mypensieve init --restart' to configure this provider, or create the file manually:\n  echo '{"api_key":"your-key-here"}' > ${secretsPath} && chmod 600 ${secretsPath}`,
		);
	}

	// Check permissions
	try {
		const dirStat = fs.statSync(path.dirname(secretsPath));
		const dirMode = dirStat.mode & 0o777;
		if (dirMode !== 0o700) {
			console.warn(
				`[mypensieve] WARNING: Secrets directory has mode ${dirMode.toString(8)}, expected 700. ` +
					`Run: chmod 700 ${path.dirname(secretsPath)}`,
			);
		}
		const fileStat = fs.statSync(secretsPath);
		const fileMode = fileStat.mode & 0o777;
		if (fileMode !== 0o600) {
			console.warn(
				`[mypensieve] WARNING: Secrets file has mode ${fileMode.toString(8)}, expected 600. ` +
					`Run: chmod 600 ${secretsPath}`,
			);
		}
	} catch {
		// stat failed - will be caught by readFileSync below
	}

	const raw = fs.readFileSync(secretsPath, "utf-8");
	const parsed = JSON.parse(raw) as Record<string, unknown>;

	if (!parsed.api_key || typeof parsed.api_key !== "string") {
		throw new Error(
			`Invalid ${provider}.json: missing or empty 'api_key' field.\n` +
				`Edit ${secretsPath} and add your API key.`,
		);
	}

	return parsed.api_key;
}

/**
 * Check whether an API key file exists for a provider (does not validate contents).
 */
export function hasProviderApiKey(provider: string): boolean {
	return fs.existsSync(path.join(SECRETS_DIR, `${provider}.json`));
}
