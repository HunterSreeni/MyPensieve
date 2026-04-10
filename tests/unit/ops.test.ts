import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logCost, readDailyCost } from "../../src/ops/cost.js";
import { pruneBackups } from "../../src/ops/backup/engine.js";

describe("Cost tracking", () => {
	let tmpDir: string;
	const originalDIRS = { logsCost: "" };

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-cost-"));
		// We need to write to a known location. Use the cost module directly.
		// The logCost function uses DIRS.logsCost, so we test readDailyCost directly.
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("readDailyCost returns null for missing date", () => {
		expect(readDailyCost("1999-01-01")).toBeNull();
	});
});

describe("Backup pruning", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-backup-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("prunes old backup files", () => {
		// Create some fake backup files
		const oldFile = path.join(tmpDir, "mypensieve-backup-2025-01-01T00-00-00.tar.gz");
		const newFile = path.join(tmpDir, "mypensieve-backup-2099-01-01T00-00-00.tar.gz");

		fs.writeFileSync(oldFile, "old backup", "utf-8");
		fs.writeFileSync(newFile, "new backup", "utf-8");

		// Set old file to very old mtime
		const oldDate = new Date("2025-01-01");
		fs.utimesSync(oldFile, oldDate, oldDate);

		const pruned = pruneBackups(tmpDir, 30);
		expect(pruned).toBe(1);
		expect(fs.existsSync(oldFile)).toBe(false);
		expect(fs.existsSync(newFile)).toBe(true);
	});

	it("returns 0 for nonexistent directory", () => {
		expect(pruneBackups("/nonexistent/dir", 30)).toBe(0);
	});

	it("does not prune within retention period", () => {
		const recentFile = path.join(tmpDir, "mypensieve-backup-2099-01-01T00-00-00.tar.gz");
		fs.writeFileSync(recentFile, "recent", "utf-8");

		const pruned = pruneBackups(tmpDir, 30);
		expect(pruned).toBe(0);
	});
});
