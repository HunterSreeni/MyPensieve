import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../config/paths.js";
import { CheckpointManager } from "../memory/checkpoint.js";
import { DecisionsLayer } from "../memory/layers/decisions.js";
import { PersonaLayer } from "../memory/layers/persona.js";
import { ThreadsLayer } from "../memory/layers/threads.js";
import { MemoryQuery } from "../memory/query.js";
import { MemoryIndex } from "../memory/sqlite-index.js";

export interface ProjectState {
	/** Project binding slug (e.g. "cli/home-user-project") */
	binding: string;
	/** Absolute path to project data directory */
	projectDir: string;
	/** SQLite memory index */
	index: MemoryIndex;
	/** L1 Decisions layer */
	decisions: DecisionsLayer;
	/** L2 Threads layer */
	threads: ThreadsLayer;
	/** L3 Persona layer */
	persona: PersonaLayer;
	/** Unified memory query API */
	memoryQuery: MemoryQuery;
	/** Extractor checkpoint manager */
	checkpoint: CheckpointManager;
}

/**
 * Load or create a project's state.
 * Creates the project directory and initializes all memory layers.
 *
 * @param binding - Project binding slug (e.g. "cli/home-user-project")
 * @param projectsDir - Override for testing (defaults to ~/.mypensieve/projects/)
 */
export function loadProject(binding: string, projectsDir?: string): ProjectState {
	const baseDir = projectsDir ?? DIRS.projects;
	const projectDir = path.join(baseDir, binding);

	// Create project directory structure
	fs.mkdirSync(projectDir, { recursive: true });
	fs.mkdirSync(path.join(projectDir, "state"), { recursive: true });

	// Initialize SQLite index
	const dbPath = path.join(projectDir, "memory-index.db");
	const index = new MemoryIndex(dbPath);

	// Initialize memory layers
	const decisions = new DecisionsLayer(projectDir, index);
	const threads = new ThreadsLayer(projectDir, index);
	const persona = new PersonaLayer(projectDir, index);
	const memoryQuery = new MemoryQuery(decisions, threads, persona);

	// Initialize checkpoint manager
	const checkpointPath = path.join(projectDir, "state", "extractor-checkpoint.json");
	const checkpoint = new CheckpointManager(checkpointPath);

	return {
		binding,
		projectDir,
		index,
		decisions,
		threads,
		persona,
		memoryQuery,
		checkpoint,
	};
}

/**
 * Close a project's resources (SQLite connection).
 */
export function closeProject(project: ProjectState): void {
	project.index.close();
}

/**
 * List all existing project bindings.
 */
export function listProjects(projectsDir?: string): string[] {
	const baseDir = projectsDir ?? DIRS.projects;
	if (!fs.existsSync(baseDir)) return [];

	const bindings: string[] = [];
	const channels = fs.readdirSync(baseDir, { withFileTypes: true });

	for (const channel of channels) {
		if (!channel.isDirectory()) continue;
		const channelDir = path.join(baseDir, channel.name);
		const projects = fs.readdirSync(channelDir, { withFileTypes: true });

		for (const project of projects) {
			if (!project.isDirectory()) continue;
			bindings.push(`${channel.name}/${project.name}`);
		}
	}

	return bindings;
}
