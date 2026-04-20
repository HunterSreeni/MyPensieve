/**
 * Persona loadouts: multiple switchable agent identities.
 *
 * Layout:
 *   ~/.mypensieve/loadouts/
 *     default/
 *       meta.json        { name, identity_prompt, personality?, created_at }
 *       persona.md       human-readable identity doc
 *     <other-name>/
 *       ...
 *
 * The "active loadout" is whichever identity is currently copied into
 * `config.agent_persona`. Switching a loadout rewrites that field from
 * the target loadout's meta.json. Loadout files are the source of truth
 * for stored identities; config.agent_persona is the live, injected copy.
 *
 * Council personalities (src/council/personas.ts + .md files) are NOT
 * loadouts - council protocol is stable by design.
 */
import fs from "node:fs";
import path from "node:path";
import { readConfig, writeConfig } from "../config/index.js";
import { CONFIG_PATH, DIRS } from "../config/paths.js";
import type { AgentPersona } from "../config/schema.js";

/** Root directory for all loadouts. */
export const LOADOUTS_DIR = path.join(DIRS.root, "loadouts");

export const DEFAULT_LOADOUT_NAME = "default";

export interface LoadoutMeta {
	name: string;
	identity_prompt: string;
	personality?: string;
	created_at: string;
	description?: string;
}

export interface LoadoutInfo {
	name: string;
	active: boolean;
	meta: LoadoutMeta;
}

export class LoadoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LoadoutError";
	}
}

/** Validate a loadout name. Rejects path separators and reserved names. */
export function isValidLoadoutName(name: string): boolean {
	if (!name || name.length > 64) return false;
	// Alphanumerics, dash, underscore only. No dots (prevents dotfiles/escape).
	return /^[A-Za-z0-9_-]+$/.test(name);
}

function assertValidName(name: string): void {
	if (!isValidLoadoutName(name)) {
		throw new LoadoutError(
			`Invalid loadout name '${name}'. Use alphanumerics, dash, underscore only (max 64 chars).`,
		);
	}
}

function loadoutDir(name: string): string {
	return path.join(LOADOUTS_DIR, name);
}

function metaPath(name: string): string {
	return path.join(loadoutDir(name), "meta.json");
}

function personaMdPath(name: string): string {
	return path.join(loadoutDir(name), "persona.md");
}

function buildPersonaMd(meta: LoadoutMeta): string {
	return `# Agent Persona - Loadout "${meta.name}"\n\n## Identity\n${meta.identity_prompt}\n\n## Personality\n${meta.personality ?? "(not set)"}\n\n## Metadata\n- Created: ${meta.created_at}\n- Description: ${meta.description ?? "(none)"}\n`;
}

/**
 * Ensure the loadouts directory exists. If no loadouts exist yet but a
 * persona is already in config, seed a "default" loadout from it. This
 * is the one-shot migration path from the pre-loadout world.
 */
export function ensureLoadoutsInitialized(configPath?: string): void {
	if (!fs.existsSync(LOADOUTS_DIR)) {
		fs.mkdirSync(LOADOUTS_DIR, { recursive: true });
	}
	const existing = listLoadoutNames();
	if (existing.length > 0) return;

	let cfg: ReturnType<typeof readConfig>;
	try {
		cfg = readConfig(configPath);
	} catch {
		return;
	}
	if (!cfg.agent_persona) return;

	const meta: LoadoutMeta = {
		name: DEFAULT_LOADOUT_NAME,
		identity_prompt: cfg.agent_persona.identity_prompt,
		personality: cfg.agent_persona.personality,
		created_at: cfg.agent_persona.created_at ?? new Date().toISOString(),
		description: "Migrated from pre-loadout agent_persona on first loadout command.",
	};
	writeLoadout(meta);
}

/** List all loadout directory names (sorted). */
export function listLoadoutNames(): string[] {
	if (!fs.existsSync(LOADOUTS_DIR)) return [];
	return fs
		.readdirSync(LOADOUTS_DIR)
		.filter((entry) => {
			const full = path.join(LOADOUTS_DIR, entry);
			return (
				isValidLoadoutName(entry) &&
				fs.statSync(full).isDirectory() &&
				fs.existsSync(path.join(full, "meta.json"))
			);
		})
		.sort();
}

/** Read a single loadout's metadata. Throws LoadoutError if missing/invalid. */
export function readLoadout(name: string): LoadoutMeta {
	assertValidName(name);
	const mp = metaPath(name);
	if (!fs.existsSync(mp)) {
		throw new LoadoutError(`Loadout '${name}' not found (${mp}).`);
	}
	const parsed = JSON.parse(fs.readFileSync(mp, "utf-8")) as LoadoutMeta;
	if (!parsed.identity_prompt || !parsed.name) {
		throw new LoadoutError(`Loadout '${name}' is missing required fields.`);
	}
	return parsed;
}

/** Write a loadout to disk (both meta.json and persona.md). */
export function writeLoadout(meta: LoadoutMeta): void {
	assertValidName(meta.name);
	fs.mkdirSync(loadoutDir(meta.name), { recursive: true });
	fs.writeFileSync(metaPath(meta.name), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
	fs.writeFileSync(personaMdPath(meta.name), buildPersonaMd(meta), "utf-8");
}

/** List loadouts with their active status. */
export function listLoadouts(configPath?: string): LoadoutInfo[] {
	const activeName = getActiveLoadoutName(configPath);
	return listLoadoutNames().map((name) => {
		const meta = readLoadout(name);
		return { name, active: name === activeName, meta };
	});
}

/** Resolve the currently-active loadout name. Falls back to "default". */
export function getActiveLoadoutName(configPath?: string): string {
	try {
		const cfg = readConfig(configPath);
		return cfg.agent_persona?.name
			? (matchLoadoutToPersona(cfg.agent_persona) ?? DEFAULT_LOADOUT_NAME)
			: DEFAULT_LOADOUT_NAME;
	} catch {
		return DEFAULT_LOADOUT_NAME;
	}
}

function matchLoadoutToPersona(persona: AgentPersona): string | null {
	// Match a loadout whose meta matches the persona's identity_prompt.
	// This keeps "active" in sync without adding a new config field.
	for (const name of listLoadoutNames()) {
		try {
			const meta = readLoadout(name);
			if (meta.identity_prompt === persona.identity_prompt && meta.name === persona.name) {
				return name;
			}
		} catch {}
	}
	return null;
}

/** Switch the active loadout by copying its contents into config.agent_persona. */
export function switchLoadout(name: string, configPath?: string): LoadoutMeta {
	const meta = readLoadout(name);
	const cfg = readConfig(configPath);
	cfg.agent_persona = {
		name: meta.name,
		identity_prompt: meta.identity_prompt,
		personality: meta.personality,
		created_at: meta.created_at,
	};
	writeConfig(cfg, configPath ?? CONFIG_PATH);
	return meta;
}

/**
 * Create (or overwrite) a loadout.
 * If overwrite is false and the loadout exists, throws.
 */
export function createLoadout(meta: LoadoutMeta, opts?: { overwrite?: boolean }): LoadoutMeta {
	assertValidName(meta.name);
	if (fs.existsSync(loadoutDir(meta.name)) && !opts?.overwrite) {
		throw new LoadoutError(
			`Loadout '${meta.name}' already exists. Use --overwrite or pick a different name.`,
		);
	}
	writeLoadout(meta);
	return meta;
}

/**
 * Delete a loadout. Refuses to delete the currently-active loadout.
 */
export function deleteLoadout(name: string, configPath?: string): void {
	assertValidName(name);
	const dir = loadoutDir(name);
	if (!fs.existsSync(dir)) {
		throw new LoadoutError(`Loadout '${name}' not found.`);
	}
	if (getActiveLoadoutName(configPath) === name) {
		throw new LoadoutError(
			`Cannot delete active loadout '${name}'. Switch to another loadout first.`,
		);
	}
	fs.rmSync(dir, { recursive: true, force: true });
}
