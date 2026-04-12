/**
 * Initialize a git repository in ~/.mypensieve/ for tracking config/persona changes.
 *
 * This gives:
 * - History of all config changes (who changed what, when)
 * - Rollback capability (self-healing can revert to last known good)
 * - Diffs (see what the agent modified in persona files)
 *
 * Secrets, logs, and SQLite binaries are gitignored.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../config/paths.js";

const GITIGNORE_CONTENT = `# MyPensieve .gitignore
# Secrets - NEVER committed
.secrets/

# Logs - append-only noise, not worth tracking
logs/

# SQLite databases - binary, rebuilt from JSONL source of truth
*.sqlite
*.sqlite-wal
*.sqlite-shm

# Init progress (temporary)
.init-progress.json

# OS junk
.DS_Store
Thumbs.db
`;

export interface GitInitResult {
	initialized: boolean;
	alreadyExists: boolean;
	error?: string;
}

/**
 * Initialize git in ~/.mypensieve/ if not already initialized.
 * Writes .gitignore and creates an initial commit.
 */
export function initGitRepo(): GitInitResult {
	const gitDir = path.join(DIRS.root, ".git");

	if (fs.existsSync(gitDir)) {
		return { initialized: false, alreadyExists: true };
	}

	// Check if git is available
	try {
		execFileSync("git", ["--version"], { stdio: "pipe" });
	} catch {
		return {
			initialized: false,
			alreadyExists: false,
			error: "git not found in PATH - skipping version tracking",
		};
	}

	try {
		// git init
		execFileSync("git", ["init"], { cwd: DIRS.root, stdio: "pipe" });

		// Write .gitignore
		fs.writeFileSync(path.join(DIRS.root, ".gitignore"), GITIGNORE_CONTENT, "utf-8");

		// Initial commit
		execFileSync("git", ["add", "."], { cwd: DIRS.root, stdio: "pipe" });
		execFileSync(
			"git",
			["commit", "-m", "Initialize MyPensieve data directory", "--allow-empty"],
			{ cwd: DIRS.root, stdio: "pipe" },
		);

		return { initialized: true, alreadyExists: false };
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		return {
			initialized: false,
			alreadyExists: false,
			error: `git init failed: ${e.message}`,
		};
	}
}

/**
 * Commit current state with a message.
 * Used by self-healing after fixes, config writes, persona updates.
 * No-op if git is not initialized.
 */
export function commitState(message: string): boolean {
	const gitDir = path.join(DIRS.root, ".git");
	if (!fs.existsSync(gitDir)) return false;

	try {
		execFileSync("git", ["add", "."], { cwd: DIRS.root, stdio: "pipe" });

		// Check if there's anything to commit
		const status = execFileSync("git", ["status", "--porcelain"], {
			cwd: DIRS.root,
			encoding: "utf-8",
		});
		if (!status.trim()) return false; // Nothing to commit

		execFileSync("git", ["commit", "-m", message], { cwd: DIRS.root, stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Get the last N commits (for doctor/status display).
 */
export function getRecentCommits(count = 5): string[] {
	const gitDir = path.join(DIRS.root, ".git");
	if (!fs.existsSync(gitDir)) return [];

	try {
		const log = execFileSync(
			"git",
			["log", `--oneline`, `-${count}`],
			{ cwd: DIRS.root, encoding: "utf-8" },
		);
		return log.trim().split("\n").filter(Boolean);
	} catch {
		return [];
	}
}
