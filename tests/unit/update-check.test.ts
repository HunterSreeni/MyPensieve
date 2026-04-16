import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock paths before import
const tmpDir = path.join(os.tmpdir(), "update-check-test-stable");
const stateDir = path.join(tmpDir, "state");

vi.mock("../../src/config/paths.js", () => ({
	DIRS: { state: path.join(os.tmpdir(), "update-check-test-stable", "state") },
}));

vi.mock("../../src/version.js", () => ({
	VERSION: "0.1.16",
}));

describe("Update check", () => {
	beforeEach(() => {
		if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
		fs.mkdirSync(stateDir, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
		vi.restoreAllMocks();
	});

	it("isNewer correctly compares semver", async () => {
		// We need to test the internal function - import dynamically
		const mod = await import("../../src/cli/update-check.js");

		// The function is not exported, but we can test via the cache behavior
		// Write a cache with a newer version
		const cacheFile = path.join(stateDir, "update-check.json");
		fs.writeFileSync(
			cacheFile,
			JSON.stringify({
				latestVersion: "0.2.0",
				checkedAt: new Date().toISOString(),
			}),
		);

		const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await mod.checkForUpdates();
		expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Update available"));
		stderrSpy.mockRestore();
	});

	it("does not notify when already on latest", async () => {
		const mod = await import("../../src/cli/update-check.js");
		const cacheFile = path.join(stateDir, "update-check.json");
		fs.writeFileSync(
			cacheFile,
			JSON.stringify({
				latestVersion: "0.1.16",
				checkedAt: new Date().toISOString(),
			}),
		);

		const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await mod.checkForUpdates();
		expect(stderrSpy).not.toHaveBeenCalled();
		stderrSpy.mockRestore();
	});

	it("does not notify when on a newer version than registry", async () => {
		const mod = await import("../../src/cli/update-check.js");
		const cacheFile = path.join(stateDir, "update-check.json");
		fs.writeFileSync(
			cacheFile,
			JSON.stringify({
				latestVersion: "0.1.14",
				checkedAt: new Date().toISOString(),
			}),
		);

		const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await mod.checkForUpdates();
		expect(stderrSpy).not.toHaveBeenCalled();
		stderrSpy.mockRestore();
	});

	it("handles missing cache file gracefully", async () => {
		// Mock fetch to fail
		vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

		const mod = await import("../../src/cli/update-check.js");
		// Should not throw
		await expect(mod.checkForUpdates()).resolves.not.toThrow();
	});
});
