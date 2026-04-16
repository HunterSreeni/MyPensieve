/**
 * Systemd user timer manager for the nightly memory extractor.
 *
 * Installs two units in ~/.config/systemd/user/:
 *   - mypensieve-extractor.service  (oneshot: runs `mypensieve extract`)
 *   - mypensieve-extractor.timer    (fires per config.extractor.cron, default 02:00 daily)
 *
 * No sudo required - same model as the main daemon.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig } from "../../config/index.js";
import { VERSION } from "../../version.js";

const SERVICE_NAME = "mypensieve-extractor";
const UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user");
const SERVICE_PATH = path.join(UNIT_DIR, `${SERVICE_NAME}.service`);
const TIMER_PATH = path.join(UNIT_DIR, `${SERVICE_NAME}.timer`);

function findBinaryPath(): string {
	try {
		return execFileSync("which", ["mypensieve"], { encoding: "utf-8" }).trim();
	} catch {
		const nvmBin = path.join(
			os.homedir(),
			".nvm",
			"versions",
			"node",
			process.version,
			"bin",
			"mypensieve",
		);
		if (fs.existsSync(nvmBin)) return nvmBin;
		const globalBin = path.join("/usr", "local", "bin", "mypensieve");
		if (fs.existsSync(globalBin)) return globalBin;
		throw new Error("Cannot find mypensieve binary. Is it installed globally?");
	}
}

function generateServiceFile(binPath: string, nodePath: string): string {
	return [
		"[Unit]",
		`Description=MyPensieve v${VERSION} - Nightly memory extractor`,
		"After=network-online.target",
		"Wants=network-online.target",
		"",
		"[Service]",
		"Type=oneshot",
		`ExecStart=${nodePath} ${binPath} extract`,
		`WorkingDirectory=${os.homedir()}`,
		`Environment=HOME=${os.homedir()}`,
		"Environment=NODE_ENV=production",
		`Environment=PATH=${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin`,
		"StandardOutput=journal",
		"StandardError=journal",
		`SyslogIdentifier=${SERVICE_NAME}`,
		"NoNewPrivileges=true",
		"ProtectSystem=strict",
		`ReadWritePaths=${os.homedir()}/.mypensieve`,
		`ReadOnlyPaths=${os.homedir()}/.pi`,
		"PrivateTmp=true",
		"",
		"[Install]",
		"WantedBy=default.target",
	].join("\n");
}

/**
 * Translate a 5-field cron expression into a systemd OnCalendar string.
 * Supports the patterns we actually emit (numeric minute/hour, '*' for the rest).
 * Falls back to "daily" if the expression is anything we don't recognize.
 */
export function cronToOnCalendar(cron: string): string {
	const parts = cron.trim().split(/\s+/);
	if (parts.length !== 5) return "daily";
	const [minute, hour, dom, month, dow] = parts;
	if (
		/^\d+$/.test(minute ?? "") &&
		/^\d+$/.test(hour ?? "") &&
		dom === "*" &&
		month === "*" &&
		dow === "*"
	) {
		return `*-*-* ${(hour ?? "0").padStart(2, "0")}:${(minute ?? "0").padStart(2, "0")}:00`;
	}
	return "daily";
}

function generateTimerFile(onCalendar: string): string {
	return [
		"[Unit]",
		`Description=MyPensieve v${VERSION} - Nightly memory extractor schedule`,
		`Requires=${SERVICE_NAME}.service`,
		"",
		"[Timer]",
		`OnCalendar=${onCalendar}`,
		"Persistent=true",
		`Unit=${SERVICE_NAME}.service`,
		"",
		"[Install]",
		"WantedBy=timers.target",
	].join("\n");
}

function systemctl(...args: string[]): string {
	try {
		return execFileSync("systemctl", ["--user", ...args], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch (err) {
		const e = err as { stderr?: string };
		if (e.stderr) return e.stderr.trim();
		throw err;
	}
}

export async function installExtractorTimer(): Promise<void> {
	if (process.platform !== "linux") {
		console.error("Extractor timer is currently Linux-only (systemd).");
		console.error("On other platforms, run `mypensieve extract` from cron/launchd.");
		process.exitCode = 1;
		return;
	}

	let cron = "0 2 * * *";
	try {
		cron = readConfig().extractor.cron;
	} catch {
		console.log("No config found - using default cron `0 2 * * *`.");
	}
	const onCalendar = cronToOnCalendar(cron);

	console.log("Installing MyPensieve extractor timer...\n");

	let binPath: string;
	try {
		binPath = findBinaryPath();
	} catch (err) {
		console.error((err as Error).message);
		process.exitCode = 1;
		return;
	}
	const nodePath = process.execPath;

	console.log(`  Binary:     ${binPath}`);
	console.log(`  Node:       ${nodePath}`);
	console.log(`  Cron:       ${cron}`);
	console.log(`  OnCalendar: ${onCalendar}`);
	console.log(`  Service:    ${SERVICE_PATH}`);
	console.log(`  Timer:      ${TIMER_PATH}`);

	fs.mkdirSync(UNIT_DIR, { recursive: true });
	fs.writeFileSync(SERVICE_PATH, generateServiceFile(binPath, nodePath), "utf-8");
	fs.writeFileSync(TIMER_PATH, generateTimerFile(onCalendar), "utf-8");
	console.log("\n  Unit files written.");

	systemctl("daemon-reload");
	systemctl("enable", `${SERVICE_NAME}.timer`);
	systemctl("start", `${SERVICE_NAME}.timer`);
	console.log("  Timer enabled and started.");

	console.log("\n  Done. The extractor will run on schedule.");
	console.log(`  View logs:    journalctl --user -u ${SERVICE_NAME} -f`);
	console.log(`  Next run:     systemctl --user list-timers ${SERVICE_NAME}.timer`);
	console.log("  Run now:      mypensieve extract");
}

export async function uninstallExtractorTimer(): Promise<void> {
	if (process.platform !== "linux") {
		console.error("Extractor timer is currently Linux-only (systemd).");
		process.exitCode = 1;
		return;
	}

	console.log("Uninstalling MyPensieve extractor timer...\n");

	systemctl("stop", `${SERVICE_NAME}.timer`);
	systemctl("disable", `${SERVICE_NAME}.timer`);
	console.log("  Timer stopped and disabled.");

	for (const p of [TIMER_PATH, SERVICE_PATH]) {
		if (fs.existsSync(p)) {
			fs.unlinkSync(p);
			console.log(`  Removed: ${p}`);
		}
	}

	systemctl("daemon-reload");
	console.log("  Daemon reloaded.\n  Done.");
}

export async function extractorTimerStatus(): Promise<void> {
	if (process.platform !== "linux") {
		console.error("Extractor timer is currently Linux-only (systemd).");
		process.exitCode = 1;
		return;
	}

	if (!fs.existsSync(TIMER_PATH)) {
		console.log("Extractor timer is not installed.");
		console.log("Run 'mypensieve extractor install' to set it up.");
		return;
	}

	console.log(`MyPensieve v${VERSION} Extractor Timer Status\n`);
	console.log(`  Timer:    ${systemctl("is-active", `${SERVICE_NAME}.timer`)}`);
	console.log(`  Enabled:  ${systemctl("is-enabled", `${SERVICE_NAME}.timer`)}`);
	console.log(`  Unit:     ${TIMER_PATH}`);
	try {
		const next = execFileSync(
			"systemctl",
			["--user", "list-timers", `${SERVICE_NAME}.timer`, "--no-pager"],
			{ encoding: "utf-8" },
		).trim();
		if (next) {
			console.log("\n  Schedule:");
			for (const line of next.split("\n")) console.log(`    ${line}`);
		}
	} catch {
		// Best effort - list-timers may fail in minimal environments.
	}
	console.log(`\n  Logs: journalctl --user -u ${SERVICE_NAME} -f`);
}
