/**
 * Personality-driven greetings.
 *
 * Reads greeting pools from ~/.mypensieve/persona/greetings.json.
 * Each personality key maps to an array of greeting strings.
 * The agent's greeting is selected randomly from the matching pool.
 *
 * Example greetings.json:
 * {
 *   "formal": ["Good day, {name}.", "Greetings. How may I assist you?"],
 *   "casual": ["Hey! What's up?", "Yo {name}, what are we working on?"],
 *   "snarky": ["Oh, you again. Let's get this over with.", "Back so soon?"]
 * }
 *
 * {name} is replaced with the agent's name at injection time.
 */
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../config/paths.js";

export type GreetingsConfig = Record<string, string[]>;

const GREETINGS_PATH = path.join(DIRS.persona, "greetings.json");

/**
 * Load greetings from the greetings.json file.
 * Returns an empty object if the file doesn't exist or is invalid.
 */
export function loadGreetings(): GreetingsConfig {
	if (!fs.existsSync(GREETINGS_PATH)) return {};
	try {
		// Size cap: skip files > 1MB to prevent OOM
		const stat = fs.statSync(GREETINGS_PATH);
		if (stat.size > 1_000_000) return {};

		const parsed = JSON.parse(fs.readFileSync(GREETINGS_PATH, "utf-8")) as Record<string, unknown>;
		// Validate: only keep entries where value is a string array
		const result: GreetingsConfig = {};
		for (const [key, val] of Object.entries(parsed)) {
			if (Array.isArray(val) && val.every((v) => typeof v === "string")) {
				result[key] = val as string[];
			}
		}
		return result;
	} catch {
		return {};
	}
}

/**
 * Pick a random greeting for the given personality style.
 * Returns null if no greetings are configured for that personality.
 *
 * Replaces {name} with the agent name if provided.
 */
export function pickGreeting(personality: string, agentName?: string): string | null {
	const greetings = loadGreetings();
	const pool = greetings[personality];
	if (!pool || pool.length === 0) return null;

	const greeting = pool[Math.floor(Math.random() * pool.length)] ?? pool[0] ?? null;
	if (!greeting) return null;

	return agentName ? greeting.replace(/\{name\}/g, agentName) : greeting;
}
