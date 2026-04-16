/**
 * Systemd user timer for periodic healthchecks.
 *
 * Runs `mypensieve doctor` every 3 days. Uses Persistent=true so if the
 * machine was off, it runs on next boot.
 *
 * Install: mypensieve doctor install
 * Remove:  mypensieve doctor uninstall
 * Status:  mypensieve doctor status
 * Run now: mypensieve doctor
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VERSION } from "../../version.js";

const SERVICE_NAME = "mypensieve-doctor";
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
		`Description=MyPensieve v${VERSION} - Periodic healthcheck`,
		"",
		"[Service]",
		"Type=oneshot",
		`ExecStart=${nodePath} ${binPath} doctor`,
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
		"PrivateTmp=true",
		"",
		"[Install]",
		"WantedBy=default.target",
	].join("\n");
}

function generateTimerFile(): string {
	return [
		"[Unit]",
		`Description=MyPensieve v${VERSION} - Healthcheck every 3 days`,
		`Requires=${SERVICE_NAME}.service`,
		"",
		"[Timer]",
		"OnCalendar=*-*-01,04,07,10,13,16,19,22,25,28 12:00:00",
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

export async function installDoctorTimer(): Promise<void> {
	if (process.platform !== "linux") {
		console.error("Doctor timer is currently Linux-only (systemd).");
		process.exitCode = 1;
		return;
	}

	console.log("Installing MyPensieve doctor timer (every 3 days at noon)...\n");

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
	console.log("  Schedule:   Every 3 days at 12:00 PM");
	console.log(`  Service:    ${SERVICE_PATH}`);
	console.log(`  Timer:      ${TIMER_PATH}`);

	fs.mkdirSync(UNIT_DIR, { recursive: true });
	fs.writeFileSync(SERVICE_PATH, generateServiceFile(binPath, nodePath), "utf-8");
	fs.writeFileSync(TIMER_PATH, generateTimerFile(), "utf-8");
	console.log("\n  Unit files written.");

	systemctl("daemon-reload");
	systemctl("enable", `${SERVICE_NAME}.timer`);
	systemctl("start", `${SERVICE_NAME}.timer`);
	console.log("  Timer enabled and started.");

	console.log("\n  Done. Doctor will run every 3 days.");
	console.log(`  View logs:  journalctl --user -u ${SERVICE_NAME} -f`);
	console.log(`  Next run:   systemctl --user list-timers ${SERVICE_NAME}.timer`);
	console.log("  Run now:    mypensieve doctor");
}

export async function uninstallDoctorTimer(): Promise<void> {
	if (process.platform !== "linux") {
		console.error("Doctor timer is currently Linux-only (systemd).");
		process.exitCode = 1;
		return;
	}

	console.log("Uninstalling MyPensieve doctor timer...\n");

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

export async function doctorTimerStatus(): Promise<void> {
	if (process.platform !== "linux") {
		console.error("Doctor timer is currently Linux-only (systemd).");
		process.exitCode = 1;
		return;
	}

	if (!fs.existsSync(TIMER_PATH)) {
		console.log("Doctor timer is not installed.");
		console.log("Run 'mypensieve doctor install' to set it up.");
		return;
	}

	console.log(`MyPensieve v${VERSION} Doctor Timer Status\n`);
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
		// Best effort
	}
	console.log(`\n  Logs: journalctl --user -u ${SERVICE_NAME} -f`);
}
