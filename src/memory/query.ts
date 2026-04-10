import type { DecisionsLayer } from "./layers/decisions.js";
import type { PersonaLayer } from "./layers/persona.js";
import type { ThreadsLayer } from "./layers/threads.js";

export interface MemoryMatch {
	layer: "decisions" | "threads" | "persona";
	content: string;
	confidence: number;
	timestamp: string;
	source?: string;
	id: string;
}

export interface RecallOptions {
	query: string;
	layers?: Array<"decisions" | "threads" | "persona" | "semantic" | "raw">;
	project?: string;
	since?: string;
	limit?: number;
}

/**
 * Unified memory query API.
 * Searches across L1 (decisions), L2 (threads), L3 (persona) layers.
 * L4 (semantic/embeddings) and L5 (raw sessions) are deferred.
 *
 * Used by the memory-recall skill via the recall verb.
 */
export class MemoryQuery {
	private decisions: DecisionsLayer;
	private threads: ThreadsLayer;
	private persona: PersonaLayer;

	constructor(decisions: DecisionsLayer, threads: ThreadsLayer, persona: PersonaLayer) {
		this.decisions = decisions;
		this.threads = threads;
		this.persona = persona;
	}

	recall(opts: RecallOptions): MemoryMatch[] {
		const layers = opts.layers ?? ["decisions", "threads", "persona"];
		const matches: MemoryMatch[] = [];

		if (layers.includes("decisions")) {
			const decisions = this.decisions.search(opts.query, {
				project: opts.project,
				limit: opts.limit,
			});
			for (const d of decisions) {
				matches.push({
					layer: "decisions",
					content: d.content,
					confidence: d.confidence,
					timestamp: d.timestamp,
					source: d.source,
					id: d.id,
				});
			}
		}

		if (layers.includes("threads")) {
			// Search thread titles
			const allThreads = this.threads.readAll();
			const queryLower = opts.query.toLowerCase();
			const matchingThreads = allThreads.filter((t) => {
				if (opts.project && t.project !== opts.project) return false;
				if (opts.since && t.updated_at < opts.since) return false;
				return (
					t.title.toLowerCase().includes(queryLower) ||
					t.messages.some((m) => m.content.toLowerCase().includes(queryLower))
				);
			});

			for (const t of matchingThreads.slice(0, opts.limit ?? 10)) {
				matches.push({
					layer: "threads",
					content: `[${t.status}] ${t.title} (${t.messages.length} messages)`,
					confidence: 0.8,
					timestamp: t.updated_at,
					id: t.id,
				});
			}
		}

		if (layers.includes("persona")) {
			const deltas = this.persona.readAll();
			const queryLower = opts.query.toLowerCase();
			const matchingDeltas = deltas.filter((d) => {
				return (
					d.content.toLowerCase().includes(queryLower) || d.field.toLowerCase().includes(queryLower)
				);
			});

			for (const d of matchingDeltas.slice(0, opts.limit ?? 10)) {
				matches.push({
					layer: "persona",
					content: `[${d.field}] ${d.content}`,
					confidence: d.confidence,
					timestamp: d.timestamp,
					id: d.id,
				});
			}
		}

		// Sort by timestamp descending, then by confidence descending
		matches.sort((a, b) => {
			const timeDiff = b.timestamp.localeCompare(a.timestamp);
			if (timeDiff !== 0) return timeDiff;
			return b.confidence - a.confidence;
		});

		return opts.limit ? matches.slice(0, opts.limit) : matches;
	}
}
