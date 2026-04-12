/**
 * Filesystem security guardrails for MyPensieve agents.
 *
 * Model: Hybrid (option 3)
 *   - Read = deny-list (block known dangerous, allow everything else)
 *   - Write = allow-list (only permit known-safe locations)
 *
 * These are enforced via Pi's beforeToolCall hook in the extension.
 */
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

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
	/\.env$/,
	/\.env\.local$/,
	/\.env\.production$/,
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
	/\bsudo\b/,
	/\bsu\b\s/,
	/\bchmod\s+777\b/,
	/\bchown\b/,
	/\brm\s+-rf\s+[/~]/,
	/\bcrontab\b/,
	/\/etc\/cron/,
	/\bcurl\b.*\|\s*(sh|bash|zsh)/,
	/\bwget\b.*\|\s*(sh|bash|zsh)/,
	/\beval\b.*\$\(/,
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
 * Check if a file path is allowed for reading.
 */
export function checkReadAccess(filePath: string): GuardrailResult {
	const resolved = path.resolve(filePath);

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
	const resolved = path.resolve(filePath);
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
	const redirectMatch = command.match(/>\s*([^\s;|&]+)/g);
	if (redirectMatch) {
		for (const redirect of redirectMatch) {
			const target = redirect.replace(/^>\s*/, "").trim();
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
