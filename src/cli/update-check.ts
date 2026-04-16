/**
 * Non-blocking npm version check on CLI startup.
 *
 * Checks the npm registry for a newer version of mypensieve. Caches the
 * result for 24 hours in ~/.mypensieve/state/update-check.json to avoid
 * hitting the registry on every invocation.
 *
 * If an update is available, prints a one-line nudge to stderr so it
 * doesn't interfere with stdout-based output (e.g. --version, status).
 * After an upgrade, nudges the user to run `mypensieve doctor`.
 */
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../config/paths.js";
import { VERSION } from "../version.js";

const CACHE_FILE = path.join(DIRS.state, "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY_TIMEOUT_MS = 3000; // 3 second timeout

interface UpdateCache {
	latestVersion: string;
	checkedAt: string;
	notifiedVersion?: string;
}

function readCache(): UpdateCache | null {
	try {
		if (!fs.existsSync(CACHE_FILE)) return null;
		const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as UpdateCache;
		const age = Date.now() - new Date(raw.checkedAt).getTime();
		if (age > CACHE_TTL_MS) return null; // stale
		return raw;
	} catch {
		return null;
	}
}

function writeCache(cache: UpdateCache): void {
	try {
		fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
		fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
	} catch {
		// Best effort - don't fail the CLI over a cache write
	}
}

/**
 * Compare two semver strings. Returns true if `latest` is newer than `current`.
 */
function isNewer(current: string, latest: string): boolean {
	const c = current.split(".").map(Number);
	const l = latest.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
		if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
	}
	return false;
}

/**
 * Check for updates and print a nudge if one is available.
 * Designed to be fire-and-forget - never throws, never blocks CLI startup
 * for more than 3 seconds.
 */
export async function checkForUpdates(): Promise<void> {
	try {
		// Check cache first
		const cached = readCache();
		if (cached) {
			if (isNewer(VERSION, cached.latestVersion)) {
				// We already know there's an update - was it the version we just upgraded to?
				if (cached.latestVersion === VERSION) {
					// User upgraded - nudge doctor
					if (cached.notifiedVersion !== VERSION) {
						console.error(
							`[mypensieve] Upgraded to v${VERSION}. Run 'mypensieve doctor' to verify everything works.`,
						);
						writeCache({ ...cached, notifiedVersion: VERSION });
					}
					return;
				}
				printUpdateNotice(cached.latestVersion);
			}
			return;
		}

		// Fetch from registry (non-blocking with timeout)
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);

		const res = await fetch("https://registry.npmjs.org/mypensieve/latest", {
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});
		clearTimeout(timeout);

		if (!res.ok) return;

		const data = (await res.json()) as { version?: string };
		const latest = data.version;
		if (!latest) return;

		const cache: UpdateCache = {
			latestVersion: latest,
			checkedAt: new Date().toISOString(),
		};
		writeCache(cache);

		if (isNewer(VERSION, latest)) {
			printUpdateNotice(latest);
		}
	} catch {
		// Network error, timeout, or any other issue - silently ignore
	}
}

function printUpdateNotice(latest: string): void {
	console.error(
		`[mypensieve] Update available: v${VERSION} -> v${latest}. Run: npm install -g mypensieve`,
	);
	console.error("[mypensieve] After upgrading, run 'mypensieve doctor' to verify your setup.");
}
