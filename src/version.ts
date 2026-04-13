import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Read the package version from package.json at runtime. */
function loadVersion(): string {
	try {
		// In dist/, package.json is one level up
		const pkgPath = path.resolve(__dirname, "..", "package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
		return pkg.version ?? "unknown";
	} catch {
		return "unknown";
	}
}

export const VERSION = loadVersion();
