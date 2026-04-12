import fs from "node:fs";
import { DIRS, PI_DIRS } from "../config/paths.js";

export class DirectoryScaffoldError extends Error {
	constructor(
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "DirectoryScaffoldError";
	}
}

interface ScaffoldResult {
	created: string[];
	existed: string[];
}

/**
 * Create the ~/.mypensieve/ directory tree with correct permissions.
 * Safe to call multiple times (idempotent).
 */
export function scaffoldDirectories(): ScaffoldResult {
	const created: string[] = [];
	const existed: string[] = [];

	// Standard dirs (mode 0755)
	const standardDirs = [
		DIRS.root,
		DIRS.projects,
		DIRS.persona,
		DIRS.logs,
		DIRS.logsErrors,
		DIRS.logsCost,
		DIRS.logsCron,
		DIRS.state,
		DIRS.stateReminders,
		DIRS.metaSkills,
	];

	for (const dir of standardDirs) {
		if (fs.existsSync(dir)) {
			existed.push(dir);
		} else {
			try {
				fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
				created.push(dir);
			} catch (err) {
				throw new DirectoryScaffoldError(`Failed to create directory: ${dir}`, err);
			}
		}
	}

	// Secrets dir (mode 0700 - owner only)
	if (fs.existsSync(DIRS.secrets)) {
		// Ensure permissions are correct even if dir already exists
		fs.chmodSync(DIRS.secrets, 0o700);
		existed.push(DIRS.secrets);
	} else {
		try {
			fs.mkdirSync(DIRS.secrets, { recursive: true, mode: 0o700 });
			created.push(DIRS.secrets);
		} catch (err) {
			throw new DirectoryScaffoldError(`Failed to create secrets directory: ${DIRS.secrets}`, err);
		}
	}

	// Pi extension directory (we write our extensions here)
	if (!fs.existsSync(PI_DIRS.mypensieveExtensions)) {
		try {
			fs.mkdirSync(PI_DIRS.mypensieveExtensions, { recursive: true, mode: 0o755 });
			created.push(PI_DIRS.mypensieveExtensions);
		} catch (err) {
			throw new DirectoryScaffoldError(
				`Failed to create Pi extension directory: ${PI_DIRS.mypensieveExtensions}`,
				err,
			);
		}
	} else {
		existed.push(PI_DIRS.mypensieveExtensions);
	}

	return { created, existed };
}

/**
 * Verify the directory scaffold is intact and permissions are correct.
 * Used by `mypensieve doctor`.
 */
export function verifyDirectories(): { ok: boolean; issues: string[] } {
	const issues: string[] = [];

	// Check all required dirs exist
	const allDirs = [
		DIRS.root,
		DIRS.projects,
		DIRS.persona,
		DIRS.logs,
		DIRS.logsErrors,
		DIRS.logsCost,
		DIRS.logsCron,
		DIRS.state,
		DIRS.stateReminders,
		DIRS.metaSkills,
		DIRS.secrets,
	];

	for (const dir of allDirs) {
		if (!fs.existsSync(dir)) {
			issues.push(`Missing directory: ${dir}`);
		}
	}

	// Check secrets dir permissions
	if (fs.existsSync(DIRS.secrets)) {
		const stats = fs.statSync(DIRS.secrets);
		const mode = stats.mode & 0o777;
		if (mode !== 0o700) {
			issues.push(`Secrets dir has wrong permissions: ${mode.toString(8)} (expected 700)`);
		}
	}

	return { ok: issues.length === 0, issues };
}
