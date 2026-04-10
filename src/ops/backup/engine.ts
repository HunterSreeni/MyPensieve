import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DIRS, SECRETS_DIR } from "../../config/paths.js";
import type { BackupConfig } from "../../config/schema.js";

export interface BackupResult {
	success: boolean;
	archivePath?: string;
	sizeBytes?: number;
	error?: string;
	duration_ms: number;
}

/**
 * Create a backup archive of ~/.mypensieve/ + ~/.pi/agent/sessions/.
 */
export function createBackup(config: BackupConfig, destination?: string): BackupResult {
	const start = Date.now();
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const archiveName = `mypensieve-backup-${timestamp}.tar.gz`;

	const dest = destination ?? config.destinations[0]?.path;
	if (!dest) {
		return {
			success: false,
			error: "No backup destination configured",
			duration_ms: Date.now() - start,
		};
	}

	fs.mkdirSync(dest, { recursive: true });
	const archivePath = path.join(dest, archiveName);

	try {
		// Build exclude list
		const excludes: string[] = [];
		if (!config.include_secrets) {
			excludes.push(`--exclude=${SECRETS_DIR}`);
		}
		excludes.push("--exclude=*.tmp");

		const excludeArgs = excludes.join(" ");
		const cmd = `tar czf "${archivePath}" ${excludeArgs} -C "${path.dirname(DIRS.root)}" "${path.basename(DIRS.root)}"`;

		execSync(cmd, { stdio: "pipe", timeout: 300000 }); // 5min timeout

		const stats = fs.statSync(archivePath);
		return {
			success: true,
			archivePath,
			sizeBytes: stats.size,
			duration_ms: Date.now() - start,
		};
	} catch (err) {
		return {
			success: false,
			error: `Backup failed: ${err instanceof Error ? err.message : String(err)}`,
			duration_ms: Date.now() - start,
		};
	}
}

/**
 * Verify a backup archive is valid.
 */
export function verifyBackup(archivePath: string): { valid: boolean; error?: string } {
	if (!fs.existsSync(archivePath)) {
		return { valid: false, error: `Archive not found: ${archivePath}` };
	}

	try {
		execSync(`tar tzf "${archivePath}" > /dev/null`, { stdio: "pipe" });
		return { valid: true };
	} catch (err) {
		return {
			valid: false,
			error: `Archive is corrupt: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/**
 * Prune old backups beyond retention period.
 */
export function pruneBackups(backupDir: string, retentionDays: number): number {
	if (!fs.existsSync(backupDir)) return 0;

	const files = fs
		.readdirSync(backupDir)
		.filter((f) => f.startsWith("mypensieve-backup-") && f.endsWith(".tar.gz"));

	const cutoff = Date.now() - retentionDays * 86400000;
	let pruned = 0;

	for (const file of files) {
		const filePath = path.join(backupDir, file);
		const stats = fs.statSync(filePath);
		if (stats.mtimeMs < cutoff) {
			fs.unlinkSync(filePath);
			pruned++;
		}
	}

	return pruned;
}
