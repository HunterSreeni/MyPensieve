import fs from "node:fs";
import path from "node:path";
import { SECRETS_DIR } from "../config/paths.js";
import { captureError } from "../ops/index.js";

export class SecretsWriteError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "SecretsWriteError";
	}
}

export interface WriteSecretResult {
	path: string;
	action: "created" | "updated";
}

/**
 * Write a JSON secret file into ~/.mypensieve/.secrets/ with mode 0600.
 * Creates the secrets dir if missing. Atomic: writes to a temp file and
 * renames. Secrets dir is expected to already be scaffolded at mode 0700.
 */
export function writeSecret(filename: string, data: Record<string, unknown>): WriteSecretResult {
	if (filename.includes("/") || filename.includes("\\") || filename.startsWith(".")) {
		const err = new SecretsWriteError(`Invalid secret filename: ${filename}`);
		captureError({
			severity: "high",
			errorType: "secrets_invalid_filename",
			errorSrc: "init:secrets-writer",
			message: err.message,
			context: { filename },
		});
		throw err;
	}

	const fullPath = path.join(SECRETS_DIR, filename);
	const tmpPath = `${fullPath}.${process.pid}.tmp`;

	try {
		if (!fs.existsSync(SECRETS_DIR)) {
			fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
		}
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "secrets_mkdir",
			errorSrc: "init:secrets-writer",
			message: e.message,
			stack: e.stack,
			context: { SECRETS_DIR },
		});
		throw new SecretsWriteError(`Failed to create secrets dir: ${SECRETS_DIR}`, err);
	}

	const existed = fs.existsSync(fullPath);
	const payload = {
		...data,
		saved_at: new Date().toISOString(),
	};

	try {
		fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
			encoding: "utf-8",
			mode: 0o600,
		});
		fs.renameSync(tmpPath, fullPath);
		fs.chmodSync(fullPath, 0o600);
	} catch (err) {
		try {
			if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
		} catch {
			// Best-effort cleanup.
		}
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "secrets_write",
			errorSrc: "init:secrets-writer",
			message: e.message,
			stack: e.stack,
			context: { fullPath },
		});
		throw new SecretsWriteError(`Failed to write secret at ${fullPath}`, err);
	}

	return { path: fullPath, action: existed ? "updated" : "created" };
}
