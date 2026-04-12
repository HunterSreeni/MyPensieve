/**
 * Cross-OS platform utilities.
 *
 * MyPensieve runs on Linux, macOS, and Windows. This module abstracts
 * the OS-specific differences so the rest of the codebase stays clean.
 *
 * Architecture decision (2026-04-12):
 *   - Cron/scheduling: IN-PROCESS (no system crontab). Cross-OS by design.
 *   - Daemon: OS-specific service file (systemd/launchd/Windows Service).
 *   - Permissions: chmod on Unix, skip on Windows (NTFS ACLs suffice).
 *   - Paths: os.homedir() everywhere. Works on all platforms.
 */
import fs from "node:fs";
import os from "node:os";

export type Platform = "linux" | "darwin" | "windows" | "unknown";

export function detectPlatform(): Platform {
	switch (os.platform()) {
		case "linux":
			return "linux";
		case "darwin":
			return "darwin";
		case "win32":
			return "windows";
		default:
			return "unknown";
	}
}

/**
 * Set file permissions (no-op on Windows where NTFS ACLs handle security).
 */
export function setFilePermissions(filePath: string, mode: number): void {
	if (os.platform() === "win32") return;
	fs.chmodSync(filePath, mode);
}

/**
 * Set directory permissions (no-op on Windows).
 */
export function setDirPermissions(dirPath: string, mode: number): void {
	if (os.platform() === "win32") return;
	fs.chmodSync(dirPath, mode);
}

/**
 * Check if a file has the expected permissions (always true on Windows).
 */
export function checkPermissions(filePath: string, expectedMode: number): boolean {
	if (os.platform() === "win32") return true;
	const stats = fs.statSync(filePath);
	return (stats.mode & 0o777) === expectedMode;
}

/**
 * Get the daemon service type for this platform.
 */
export function getDaemonType(): "systemd" | "launchd" | "windows-service" | "unsupported" {
	const platform = detectPlatform();
	switch (platform) {
		case "linux":
			return "systemd";
		case "darwin":
			return "launchd";
		case "windows":
			return "windows-service";
		default:
			return "unsupported";
	}
}
