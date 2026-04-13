/**
 * Filesystem security guardrails for MyPensieve agents.
 *
 * Model: Hybrid (option 3)
 *   - Read = deny-list (block known dangerous, allow everything else)
 *   - Write = allow-list (only permit known-safe locations)
 *
 * These are enforced via Pi's beforeToolCall hook in the extension.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

/** Escape special regex characters in a string for use in RegExp constructor. */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Read Deny-List ---
// Patterns that should NEVER be read by the agent

const READ_DENY_EXACT = [
	"/etc/shadow",
	"/etc/passwd",
	"/etc/sudoers",
	"/etc/master.passwd",
	path.join(HOME, ".bash_history"),
	path.join(HOME, ".zsh_history"),
	path.join(HOME, ".bashrc"),
	path.join(HOME, ".zshrc"),
	path.join(HOME, ".profile"),
	path.join(HOME, ".bash_profile"),
	path.join(HOME, ".zprofile"),
	path.join(HOME, ".netrc"),
	path.join(HOME, ".npmrc"),
];

const READ_DENY_PREFIXES = [
	"/etc/sudoers.d/",
	"/etc/pam.d/",
	"/etc/security/",
	"/proc/",
	"/sys/",
	path.join(HOME, ".ssh/"),
	path.join(HOME, ".gnupg/"),
	path.join(HOME, ".config/"),
	path.join(HOME, ".local/share/keyrings/"),
	path.join(HOME, ".password-store/"),
];

const READ_DENY_PATTERNS = [
	/\.pem$/,
	/\.key$/,
	/id_rsa/,
	/id_ed25519/,
	/id_ecdsa/,
	/credentials\.json$/,
	/\.env(\..+)?$/, // matches .env, .env.local, .env.production, .env.development, .env.staging, etc.
];

// --- Write Allow-List ---
// Only these prefixes are permitted for writes

function getWriteAllowPrefixes(cwd: string): string[] {
	return [
		path.join(HOME, ".mypensieve/"),
		path.join(cwd, "/"), // ensure trailing slash for prefix match
		"/tmp/",
	];
}

// --- Bash Command Deny Patterns ---
// Commands that should never be executed

const BASH_DENY_PATTERNS = [
	// Privilege escalation - match both bare and absolute paths
	/(?:^|[\s;|&])(?:\/usr\/bin\/|\/bin\/)?sudo\b/,
	/(?:^|[\s;|&])(?:\/usr\/bin\/|\/bin\/)?su\s/,

	// Destructive file operations
	/\bchmod\s+777\b/,
	/\bchown\b/,
	/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r[a-zA-Z]*|-[a-zA-Z]*rf[a-zA-Z]*|-[a-zA-Z]*fr[a-zA-Z]*)\s+[/~]/, // rm -rf, rm -r -f, rm -fr, etc.
	/\bfind\b.*\s-delete\b/,
	/\bdd\b.*\bof\s*=\s*\/dev\//,

	// System scheduler manipulation
	/\bcrontab\b/,
	/\/etc\/cron/,

	// Pipe-to-shell (remote code execution)
	/\bcurl\b.*\|\s*(sh|bash|zsh)/,
	/\bwget\b.*\|\s*(sh|bash|zsh)/,

	// Download-then-execute patterns
	/\bcurl\b.*-o\s+\S+.*&&\s*(sh|bash|zsh|chmod)\b/,
	/\bwget\b.*&&\s*(sh|bash|zsh|chmod)\b/,

	// Eval with subshell
	/\beval\b/,

	// Interpreter-based subprocess escapes
	/\bpython[23]?\b.*\bsubprocess\b/,
	/\bpython[23]?\b.*\bos\.system\b/,
	/\bpython[23]?\b.*\bos\.popen\b/,
	/\bperl\b.*\bsystem\b/,
	/\bnode\b.*\bchild_process\b/,
	/\bruby\b.*\bsystem\b/,

	// Dangerous write commands targeting system paths
	/\btee\b.*\s\/etc\//,
	new RegExp(`\\btee\\b.*\\s${escapeRegex(HOME)}/\\.`),
	/\bcp\b.*\s\/etc\//,
	new RegExp(`\\bcp\\b.*\\s${escapeRegex(HOME)}/\\.ssh/`),
	/\bmv\b.*\s\/etc\//,
	new RegExp(`\\bmv\\b.*\\s${escapeRegex(HOME)}/\\.ssh/`),
	/\binstall\b.*\s\/etc\//,
	/\brsync\b.*\s\/etc\//,
	/\bdd\b.*\bof\s*=\s*\/etc\//,

	// Redirect to system files (handled more thoroughly in redirect validation below)
	/>\s*\/etc\//,
	/>\s*~\/\.(bash|zsh|profile)/,
];

// Paths that bash commands should not reference for writes
const BASH_WRITE_DENY_PATHS = [
	"/etc/",
	path.join(HOME, ".ssh/"),
	path.join(HOME, ".gnupg/"),
	path.join(HOME, ".bashrc"),
	path.join(HOME, ".zshrc"),
	path.join(HOME, ".profile"),
];

export interface GuardrailResult {
	allowed: boolean;
	reason?: string;
}

/**
 * Resolve a path through symlinks when possible.
 * Falls back to path.resolve() if the file doesn't exist yet (ENOENT).
 */
function resolveRealPath(filePath: string): string {
	try {
		return fs.realpathSync(filePath);
	} catch {
		// File doesn't exist yet - resolve logically (safe for new file writes)
		return path.resolve(filePath);
	}
}

/**
 * Check if a file path is allowed for reading.
 */
export function checkReadAccess(filePath: string): GuardrailResult {
	const resolved = resolveRealPath(filePath);

	// Check exact matches
	if (READ_DENY_EXACT.includes(resolved)) {
		return { allowed: false, reason: `Access denied: ${resolved} is a protected system file` };
	}

	// Check prefix matches
	for (const prefix of READ_DENY_PREFIXES) {
		if (resolved.startsWith(prefix)) {
			return { allowed: false, reason: `Access denied: files under ${prefix} are protected` };
		}
	}

	// Check pattern matches (only for files outside ~/.mypensieve/)
	const mypensieveDir = path.join(HOME, ".mypensieve/");
	if (!resolved.startsWith(mypensieveDir)) {
		for (const pattern of READ_DENY_PATTERNS) {
			if (pattern.test(resolved)) {
				return {
					allowed: false,
					reason: `Access denied: ${path.basename(resolved)} matches a protected file pattern`,
				};
			}
		}
	}

	return { allowed: true };
}

/**
 * Check if a file path is allowed for writing.
 */
export function checkWriteAccess(filePath: string, cwd: string): GuardrailResult {
	const resolved = resolveRealPath(filePath);
	const allowPrefixes = getWriteAllowPrefixes(cwd);

	for (const prefix of allowPrefixes) {
		if (resolved.startsWith(prefix)) {
			return { allowed: true };
		}
	}

	return {
		allowed: false,
		reason: `Write denied: ${resolved} is outside allowed write locations. Allowed: ~/.mypensieve/, project directory, /tmp/`,
	};
}

/**
 * Check if a bash command is safe to execute.
 */
export function checkBashCommand(command: string, cwd: string): GuardrailResult {
	// Check deny patterns
	for (const pattern of BASH_DENY_PATTERNS) {
		if (pattern.test(command)) {
			return {
				allowed: false,
				reason: `Command blocked: matches dangerous pattern (${pattern.source})`,
			};
		}
	}

	// Check for write redirections to denied paths
	// Matches >, >>, N> (fd redirect), N>> patterns
	const redirectMatch = command.match(/\d*>{1,2}\s*([^\s;|&]+)/g);
	if (redirectMatch) {
		for (const redirect of redirectMatch) {
			const target = redirect.replace(/^\d*>{1,2}\s*/, "").trim();
			const resolved = path.resolve(cwd, target);

			// Check if redirect target is in a denied location
			for (const denyPath of BASH_WRITE_DENY_PATHS) {
				if (resolved.startsWith(denyPath) || resolved === denyPath.replace(/\/$/, "")) {
					return {
						allowed: false,
						reason: `Command blocked: writes to protected path ${denyPath}`,
					};
				}
			}
		}
	}

	return { allowed: true };
}
