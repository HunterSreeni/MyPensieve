import fs from "node:fs";
import { CONFIG_PATH, DIRS } from "../../config/paths.js";
import { ConfigReadError, readConfig } from "../../config/reader.js";
import { verifyDirectories } from "../../init/directories.js";

interface DoctorCheck {
	name: string;
	status: "ok" | "warn" | "fail";
	message: string;
}

/**
 * Run healthcheck against all MyPensieve components.
 * Reports issues and suggestions.
 */
export function runDoctor(): void {
	const checks: DoctorCheck[] = [];

	// Check 1: Config file
	try {
		readConfig();
		checks.push({ name: "Config", status: "ok", message: `Valid config at ${CONFIG_PATH}` });
	} catch (err) {
		if (err instanceof ConfigReadError) {
			checks.push({ name: "Config", status: "fail", message: err.message });
		} else {
			checks.push({ name: "Config", status: "fail", message: "Unknown config error" });
		}
	}

	// Check 2: Directory structure
	const dirResult = verifyDirectories();
	if (dirResult.ok) {
		checks.push({
			name: "Directories",
			status: "ok",
			message: "All directories present with correct permissions",
		});
	} else {
		for (const issue of dirResult.issues) {
			checks.push({ name: "Directories", status: "fail", message: issue });
		}
	}

	// Check 3: Backup freshness
	try {
		const config = readConfig();
		if (config.backup.enabled) {
			const destination = config.backup.destinations[0];
			if (destination) {
				const backupPath = destination.path;
				if (fs.existsSync(backupPath)) {
					const files = fs.readdirSync(backupPath).filter((f) => f.endsWith(".tar.gz"));
					if (files.length === 0) {
						checks.push({ name: "Backup", status: "warn", message: "No backup files found" });
					} else {
						const latest = files.sort().pop() ?? "";
						const stat = fs.statSync(`${backupPath}/${latest}`);
						const ageMs = Date.now() - stat.mtimeMs;
						const ageDays = ageMs / (1000 * 60 * 60 * 24);
						if (ageDays > 7) {
							checks.push({
								name: "Backup",
								status: "fail",
								message: `Latest backup is ${Math.floor(ageDays)} days old (max 7)`,
							});
						} else if (ageDays > 2) {
							checks.push({
								name: "Backup",
								status: "warn",
								message: `Latest backup is ${Math.floor(ageDays)} days old`,
							});
						} else {
							checks.push({ name: "Backup", status: "ok", message: `Latest backup: ${latest}` });
						}
					}
				} else {
					checks.push({
						name: "Backup",
						status: "warn",
						message: `Backup destination doesn't exist: ${backupPath}`,
					});
				}
			}
		} else {
			checks.push({ name: "Backup", status: "warn", message: "Backups disabled in config" });
		}
	} catch {
		checks.push({
			name: "Backup",
			status: "warn",
			message: "Could not check backup status (config not loaded)",
		});
	}

	// Check 4: Error log
	const today = new Date().toISOString().slice(0, 10);
	const errorLogPath = `${DIRS.logsErrors}/${today}.jsonl`;
	if (fs.existsSync(errorLogPath)) {
		const lines = fs.readFileSync(errorLogPath, "utf-8").trim().split("\n").filter(Boolean);
		const unresolvedCount = lines.filter((l) => {
			try {
				const entry = JSON.parse(l);
				return !entry.resolved;
			} catch {
				return false;
			}
		}).length;

		if (unresolvedCount > 0) {
			checks.push({
				name: "Errors",
				status: "warn",
				message: `${unresolvedCount} unresolved errors today. Run 'mypensieve errors'`,
			});
		} else {
			checks.push({ name: "Errors", status: "ok", message: "No unresolved errors today" });
		}
	} else {
		checks.push({ name: "Errors", status: "ok", message: "No error log for today" });
	}

	// Print results
	console.log("\nMyPensieve Health Check\n");

	let hasFailures = false;
	for (const check of checks) {
		const icon = check.status === "ok" ? "+" : check.status === "warn" ? "!" : "x";
		const label = check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
		console.log(`  [${icon}] ${label.padEnd(5)} ${check.name}: ${check.message}`);
		if (check.status === "fail") hasFailures = true;
	}

	console.log("");
	if (hasFailures) {
		console.log("Some checks failed. Run 'mypensieve recover' to attempt auto-fix.");
		process.exitCode = 1;
	} else {
		console.log("All checks passed.");
	}
}
