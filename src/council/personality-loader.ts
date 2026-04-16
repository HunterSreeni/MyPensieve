/**
 * Council personality loader.
 *
 * Loads agent personality text from ~/.mypensieve/persona/{agent-name}.md.
 * Falls back to hardcoded defaults if the file doesn't exist or is still
 * a template. Caches on first read per process lifetime.
 *
 * The split:
 * - Protocol (stays in TS): phase participation, structured channels,
 *   consensus rules, verb access - what the agent CAN DO
 * - Personality (lives in .md): tone, strictness, focus areas,
 *   communication style - WHO the agent IS
 */
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../config/paths.js";
import { PERSONA_TEMPLATE_MARKER } from "../init/persona-templates.js";
import { DEFAULT_PERSONALITIES } from "./personas.js";

const cache = new Map<string, string>();

/**
 * Load the personality text for a council agent.
 *
 * Priority:
 * 1. ~/.mypensieve/persona/{agentName}.md (if exists and not template)
 * 2. Hardcoded default from DEFAULT_PERSONALITIES
 * 3. Empty string (unknown agent)
 */
export function loadCouncilPersonality(agentName: string): string {
	const cached = cache.get(agentName);
	if (cached !== undefined) return cached;

	const filePath = path.join(DIRS.persona, `${agentName}.md`);
	let personality: string;

	const fallback = DEFAULT_PERSONALITIES[agentName] ?? "";

	if (fs.existsSync(filePath)) {
		// Size cap: skip files > 100KB to prevent OOM from malicious/runaway files
		try {
			const stat = fs.statSync(filePath);
			if (stat.size > 100_000) {
				console.warn(
					`[mypensieve] WARNING: Personality file ${filePath} is ${stat.size} bytes (max 100KB). Using default.`,
				);
				personality = fallback;
			} else {
				const content = fs.readFileSync(filePath, "utf-8");
				const trimmed = content.trim();
				if (!trimmed || content.includes(PERSONA_TEMPLATE_MARKER)) {
					// Empty file or template - fall back to default
					personality = fallback;
				} else {
					personality = trimmed;
				}
			}
		} catch {
			personality = fallback;
		}
	} else {
		personality = fallback;
	}

	cache.set(agentName, personality);
	return personality;
}

/**
 * Clear the personality cache. Useful for testing or after persona edits.
 */
export function clearPersonalityCache(): void {
	cache.clear();
}
