/**
 * Systemd user service manager for MyPensieve.
 *
 * Creates a user-level systemd service that:
 * - Runs `mypensieve start` (Telegram + echoes)
 * - Auto-restarts on failure (5s delay)
 * - Starts on boot (requires loginctl enable-linger)
 * - Logs to journalctl --user -u mypensieve
 *
 * No sudo required - uses ~/.config/systemd/user/
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VERSION } from "../../version.js";

const SERVICE_NAME = "mypensieve";
const UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user");
const UNIT_PATH = path.join(UNIT_DIR, `${SERVICE_NAME}.service`);

/**
 * Find the absolute path to the mypensieve binary.
 */
function findBinaryPath(): string {
	try {
		return execFileSync("which", ["mypensieve"], { encoding: "utf-8" }).trim();
	} catch {
		// Fallback: check common nvm/npm paths
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

/**
 * Find the absolute path to the node binary.
 */
function findNodePath(): string {
	return process.execPath;
}

/**
 * Generate the systemd unit file content.
 */
function generateUnitFile(binPath: string, nodePath: string): string {
	return [
		"[Unit]",
		`Description=MyPensieve v${VERSION} - Autonomous Agent OS`,
		"After=network-online.target",
		"Wants=network-online.target",
		"",
		"[Service]",
		"Type=simple",
		`ExecStart=${nodePath} ${binPath} start`,
		`WorkingDirectory=${os.homedir()}`,
		"Restart=on-failure",
		"RestartSec=5",
		"",
		"# Environment",
		`Environment=HOME=${os.homedir()}`,
		"Environment=NODE_ENV=production",
		`Environment=PATH=${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin`,
		"",
		"# Logging",
		"StandardOutput=journal",
		"StandardError=journal",
		`SyslogIdentifier=${SERVICE_NAME}`,
		"",
		"# Security hardening",
		"NoNewPrivileges=true",
		"ProtectSystem=strict",
		`ReadWritePaths=${os.homedir()}/.mypensieve`,
		`ReadOnlyPaths=${os.homedir()}`,
		"PrivateTmp=true",
		"",
		"[Install]",
		"WantedBy=default.target",
	].join("\n");
}

/**
 * Run a systemctl --user command and return stdout.
 */
function systemctl(...args: string[]): string {
	try {
		return execFileSync("systemctl", ["--user", ...args], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch (err) {
		const e = err as { stderr?: string; status?: number };
		if (e.stderr) return e.stderr.trim();
		throw err;
	}
}

/**
 * Check if loginctl linger is enabled for the current user.
 */
function isLingerEnabled(): boolean {
	try {
		const output = execFileSync(
			"loginctl",
			["show-user", os.userInfo().username, "--property=Linger"],
			{
				encoding: "utf-8",
			},
		).trim();
		return output === "Linger=yes";
	} catch {
		return false;
	}
}

export async function installDaemon(): Promise<void> {
	if (process.platform !== "linux") {
		console.error("Daemon install is currently Linux-only (systemd).");
		console.error("macOS launchd support planned for a future release.");
		process.exitCode = 1;
		return;
	}

	console.log("Installing MyPensieve systemd service...\n");

	// Find binaries
	let binPath: string;
	let nodePath: string;
	try {
		binPath = findBinaryPath();
		nodePath = findNodePath();
	} catch (err) {
		console.error((err as Error).message);
		process.exitCode = 1;
		return;
	}

	console.log(`  Binary:  ${binPath}`);
	console.log(`  Node:    ${nodePath}`);
	console.log(`  Service: ${UNIT_PATH}`);

	// Create unit directory
	fs.mkdirSync(UNIT_DIR, { recursive: true });

	// Write unit file
	const unitContent = generateUnitFile(binPath, nodePath);
	fs.writeFileSync(UNIT_PATH, unitContent, { encoding: "utf-8" });
	console.log("\n  Unit file written.");

	// Reload systemd
	systemctl("daemon-reload");
	console.log("  Daemon reloaded.");

	// Enable (start on boot)
	systemctl("enable", SERVICE_NAME);
	console.log("  Service enabled (start on boot).");

	// Start now
	systemctl("start", SERVICE_NAME);
	console.log("  Service started.");

	// Check linger
	if (!isLingerEnabled()) {
		console.log("\n  WARNING: loginctl linger is not enabled for your user.");
		console.log("  Without linger, the service stops when you log out.");
		console.log(`  Enable it with: loginctl enable-linger ${os.userInfo().username}`);
	}

	console.log("\n  Done! MyPensieve is now running as a background service.");
	console.log(`  View logs: journalctl --user -u ${SERVICE_NAME} -f`);
	console.log("  Check status: mypensieve daemon status");
}

export async function uninstallDaemon(): Promise<void> {
	if (process.platform !== "linux") {
		console.error("Daemon uninstall is currently Linux-only (systemd).");
		process.exitCode = 1;
		return;
	}

	console.log("Uninstalling MyPensieve systemd service...\n");

	// Stop if running
	systemctl("stop", SERVICE_NAME);
	console.log("  Service stopped.");

	// Disable
	systemctl("disable", SERVICE_NAME);
	console.log("  Service disabled.");

	// Remove unit file
	if (fs.existsSync(UNIT_PATH)) {
		fs.unlinkSync(UNIT_PATH);
		console.log(`  Unit file removed: ${UNIT_PATH}`);
	}

	// Reload
	systemctl("daemon-reload");
	console.log("  Daemon reloaded.");

	console.log("\n  Done! MyPensieve service has been removed.");
}

export async function daemonStatus(): Promise<void> {
	if (process.platform !== "linux") {
		console.error("Daemon status is currently Linux-only (systemd).");
		process.exitCode = 1;
		return;
	}

	if (!fs.existsSync(UNIT_PATH)) {
		console.log("MyPensieve daemon is not installed.");
		console.log("Run 'mypensieve daemon install' to set it up.");
		return;
	}

	console.log(`MyPensieve v${VERSION} Daemon Status\n`);

	// Service status
	const status = systemctl("is-active", SERVICE_NAME);
	const enabled = systemctl("is-enabled", SERVICE_NAME);
	const linger = isLingerEnabled();

	console.log(`  Service:  ${status}`);
	console.log(`  Enabled:  ${enabled}`);
	console.log(`  Linger:   ${linger ? "yes" : "no (service stops on logout)"}`);
	console.log(`  Unit:     ${UNIT_PATH}`);
	console.log(`\n  Logs: journalctl --user -u ${SERVICE_NAME} -f`);

	if (status === "active") {
		// Show recent log lines
		try {
			const logs = execFileSync(
				"journalctl",
				["--user", "-u", SERVICE_NAME, "--no-pager", "-n", "5", "--output=short"],
				{ encoding: "utf-8" },
			).trim();
			if (logs) {
				console.log("\n  Recent logs:");
				for (const line of logs.split("\n")) {
					console.log(`    ${line}`);
				}
			}
		} catch {
			// journalctl might not be available
		}
	}
}
