import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_PATH, DIRS, SECRETS_DIR } from "../../config/paths.js";
import { ConfigReadError, readConfig } from "../../config/reader.js";
import { parseModelString, resolveDefaultModel } from "../../config/schema.js";
import { verifyDirectories } from "../../init/directories.js";
import { getOllamaHost, probeOllama } from "../../providers/ollama.js";
import { hasProviderApiKey } from "../../providers/secrets.js";
import { VERSION } from "../../version.js";

interface DoctorCheck {
	name: string;
	status: "ok" | "warn" | "fail";
	message: string;
}

function checkConfig(): DoctorCheck {
	try {
		readConfig();
		return { name: "Config", status: "ok", message: `Valid config at ${CONFIG_PATH}` };
	} catch (err) {
		if (err instanceof ConfigReadError) {
			return { name: "Config", status: "fail", message: err.message };
		}
		return { name: "Config", status: "fail", message: "Unknown config error" };
	}
}

function checkDirectories(): DoctorCheck[] {
	const dirResult = verifyDirectories();
	if (dirResult.ok) {
		return [
			{
				name: "Directories",
				status: "ok",
				message: "All directories present with correct permissions",
			},
		];
	}
	return dirResult.issues.map((issue) => ({
		name: "Directories",
		status: "fail" as const,
		message: issue,
	}));
}

function checkBackup(): DoctorCheck {
	try {
		const config = readConfig();
		if (!config.backup.enabled) {
			return { name: "Backup", status: "warn", message: "Backups disabled in config" };
		}
		const destination = config.backup.destinations[0];
		if (!destination)
			return { name: "Backup", status: "warn", message: "No backup destination configured" };

		const backupPath = destination.path;
		if (!fs.existsSync(backupPath)) {
			return {
				name: "Backup",
				status: "warn",
				message: `Backup destination doesn't exist: ${backupPath}`,
			};
		}

		const files = fs.readdirSync(backupPath).filter((f) => f.endsWith(".tar.gz"));
		if (files.length === 0) {
			return { name: "Backup", status: "warn", message: "No backup files found" };
		}

		const latest = files.sort().pop() ?? "";
		const stat = fs.statSync(`${backupPath}/${latest}`);
		const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
		if (ageDays > 7) {
			return {
				name: "Backup",
				status: "fail",
				message: `Latest backup is ${Math.floor(ageDays)} days old (max 7)`,
			};
		}
		if (ageDays > 2) {
			return {
				name: "Backup",
				status: "warn",
				message: `Latest backup is ${Math.floor(ageDays)} days old`,
			};
		}
		return { name: "Backup", status: "ok", message: `Latest backup: ${latest}` };
	} catch {
		return {
			name: "Backup",
			status: "warn",
			message: "Could not check backup status (config not loaded)",
		};
	}
}

function checkErrors(): DoctorCheck {
	const today = new Date().toISOString().slice(0, 10);
	const errorLogPath = `${DIRS.logsErrors}/${today}.jsonl`;
	if (!fs.existsSync(errorLogPath)) {
		return { name: "Errors", status: "ok", message: "No error log for today" };
	}

	const lines = fs.readFileSync(errorLogPath, "utf-8").trim().split("\n").filter(Boolean);
	const unresolvedCount = lines.filter((l) => {
		try {
			return !(JSON.parse(l) as { resolved?: boolean }).resolved;
		} catch {
			return false;
		}
	}).length;

	if (unresolvedCount > 0) {
		return {
			name: "Errors",
			status: "warn",
			message: `${unresolvedCount} unresolved errors today. Run 'mypensieve errors'`,
		};
	}
	return { name: "Errors", status: "ok", message: "No unresolved errors today" };
}

async function checkVersion(): Promise<DoctorCheck> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 3000);
		const res = await fetch("https://registry.npmjs.org/mypensieve/latest", {
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});
		clearTimeout(timeout);

		if (!res.ok)
			return { name: "Version", status: "ok", message: `v${VERSION} (registry check failed)` };

		const data = (await res.json()) as { version?: string };
		const latest = data.version;
		if (!latest || latest === VERSION) {
			return { name: "Version", status: "ok", message: `v${VERSION} (latest)` };
		}

		const c = VERSION.split(".").map(Number);
		const l = latest.split(".").map(Number);
		const newer = l.some((v, i) => v > (c[i] ?? 0));
		if (newer) {
			return {
				name: "Version",
				status: "warn",
				message: `Update available: v${VERSION} -> v${latest}. Run: npm install -g mypensieve`,
			};
		}
		return { name: "Version", status: "ok", message: `v${VERSION} (latest)` };
	} catch {
		return { name: "Version", status: "ok", message: `v${VERSION} (offline)` };
	}
}

function checkExtractorTimer(): DoctorCheck {
	try {
		const timerPath = `${process.env.HOME}/.config/systemd/user/mypensieve-extractor.timer`;
		if (fs.existsSync(timerPath)) {
			return { name: "Extractor Timer", status: "ok", message: "Installed (Persistent=true)" };
		}
		return {
			name: "Extractor Timer",
			status: "warn",
			message: "Not installed. Run: mypensieve extractor install",
		};
	} catch {
		return { name: "Extractor Timer", status: "ok", message: "Check skipped" };
	}
}

async function checkOllama(): Promise<DoctorCheck[]> {
	try {
		const config = readConfig();
		const modelString = resolveDefaultModel(config);
		const { modelId } = parseModelString(modelString);
		const host = getOllamaHost();
		const probe = await probeOllama(host);

		if (!probe.ok) {
			return [
				{
					name: "Ollama",
					status: "fail",
					message: `Cannot reach Ollama at ${host}: ${probe.error}`,
				},
			];
		}

		const results: DoctorCheck[] = [
			{ name: "Ollama", status: "ok", message: `Connected to ${host}` },
		];
		const modelExists = probe.models.some(
			(m) => m.name === modelId || m.name.startsWith(`${modelId}:`),
		);
		if (modelExists) {
			results.push({ name: "Model", status: "ok", message: `${modelId} available` });
		} else {
			results.push({
				name: "Model",
				status: "warn",
				message: `${modelId} not found locally (may be a cloud model pulled on demand)`,
			});
		}
		return results;
	} catch {
		return [{ name: "Ollama", status: "warn", message: "Could not check (config not loaded)" }];
	}
}

function checkProviderKeys(): DoctorCheck[] {
	let config: ReturnType<typeof readConfig>;
	try {
		config = readConfig();
	} catch {
		return [];
	}
	const providers = new Set<string>();
	const collect = (modelString?: string) => {
		if (!modelString) return;
		try {
			providers.add(parseModelString(modelString).provider);
		} catch {
			// Ignore malformed model strings here - checkConfig reports config errors.
		}
	};
	collect(config.default_model);
	collect(config.tier_routing?.default);
	for (const m of Object.values(config.agent_models ?? {})) collect(m);

	const results: DoctorCheck[] = [];
	for (const provider of providers) {
		if (provider === "ollama") continue; // ollama uses no API key file
		if (hasProviderApiKey(provider)) {
			results.push({
				name: `Provider key (${provider})`,
				status: "ok",
				message: `Found at ${SECRETS_DIR}/${provider}.json`,
			});
		} else {
			results.push({
				name: `Provider key (${provider})`,
				status: "fail",
				message: `Missing ${SECRETS_DIR}/${provider}.json. Model references ${provider} but no key is configured.`,
			});
		}
	}
	return results;
}

function checkTelegram(): DoctorCheck[] {
	let config: ReturnType<typeof readConfig>;
	try {
		config = readConfig();
	} catch {
		return [];
	}
	if (!config.channels.telegram.enabled) {
		return [{ name: "Telegram", status: "ok", message: "Channel disabled (skipped)" }];
	}

	const tokenPath = path.join(SECRETS_DIR, "telegram.json");
	if (!fs.existsSync(tokenPath)) {
		return [
			{
				name: "Telegram",
				status: "fail",
				message: `Channel enabled but bot token is missing at ${tokenPath}`,
			},
		];
	}

	const peers = config.channels.telegram.allowed_peers;
	if (!peers || peers.length === 0) {
		return [
			{
				name: "Telegram",
				status: "fail",
				message:
					"Channel enabled but allowed_peers is empty. Bot would reject every message. Add your numeric Telegram user ID to config.json.",
			},
		];
	}

	return [
		{
			name: "Telegram",
			status: "ok",
			message: `Enabled, ${peers.length} peer${peers.length === 1 ? "" : "s"} whitelisted`,
		},
	];
}

function checkDaemonService(): DoctorCheck {
	if (os.platform() !== "linux") {
		return { name: "Daemon service", status: "ok", message: "Skipped (non-Linux)" };
	}
	const unitPath = path.join(os.homedir(), ".config", "systemd", "user", "mypensieve.service");
	if (!fs.existsSync(unitPath)) {
		return {
			name: "Daemon service",
			status: "warn",
			message: "Not installed. Run 'mypensieve daemon install' to run MyPensieve unattended.",
		};
	}
	try {
		const out = execFileSync("systemctl", ["--user", "is-active", "mypensieve.service"], {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (out === "active") {
			return { name: "Daemon service", status: "ok", message: "Installed and active" };
		}
		return {
			name: "Daemon service",
			status: "warn",
			message: `Installed but ${out}. Run: systemctl --user start mypensieve.service`,
		};
	} catch {
		return {
			name: "Daemon service",
			status: "warn",
			message: "Installed but inactive. Run: systemctl --user start mypensieve.service",
		};
	}
}

/**
 * Run healthcheck against all MyPensieve components.
 * Reports issues and suggestions.
 */
export async function runDoctor(): Promise<void> {
	const checks: DoctorCheck[] = [];

	checks.push(checkConfig());
	checks.push(...checkDirectories());
	checks.push(...checkProviderKeys());
	checks.push(...checkTelegram());
	checks.push(checkDaemonService());
	checks.push(checkBackup());
	checks.push(checkErrors());
	checks.push(await checkVersion());
	checks.push(checkExtractorTimer());
	checks.push(...(await checkOllama()));

	// Print results
	console.log(`\nMyPensieve v${VERSION} Health Check\n`);

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
