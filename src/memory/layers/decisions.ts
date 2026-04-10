import crypto from "node:crypto";
import path from "node:path";
import { appendJsonl, readJsonlSync } from "../../utils/jsonl.js";
import type { MemoryIndex } from "../sqlite-index.js";
import type { Decision } from "../types.js";

/**
 * L1 Decisions layer.
 * Append-only JSONL as source of truth, SQLite as derived index.
 */
export class DecisionsLayer {
	private jsonlPath: string;
	private index: MemoryIndex;

	constructor(projectDir: string, index: MemoryIndex) {
		this.jsonlPath = path.join(projectDir, "decisions.jsonl");
		this.index = index;
	}

	/**
	 * Add a decision. Idempotent - if the ID already exists, it's a no-op.
	 */
	addDecision(opts: {
		sessionId: string;
		project: string;
		content: string;
		confidence: number;
		source: "manual" | "auto";
		tags?: string[];
		supersedes?: string;
	}): Decision {
		const decision: Decision = {
			id: `d-${crypto.randomUUID()}`,
			timestamp: new Date().toISOString(),
			session_id: opts.sessionId,
			project: opts.project,
			content: opts.content,
			confidence: opts.confidence,
			source: opts.source,
			tags: opts.tags ?? [],
			supersedes: opts.supersedes,
		};

		// Append to JSONL (source of truth)
		appendJsonl(this.jsonlPath, decision);

		// Sync to SQLite index
		this.index.indexDecision(decision);

		return decision;
	}

	/**
	 * Query decisions via SQLite index (fast).
	 */
	query(opts: {
		project?: string;
		since?: string;
		minConfidence?: number;
		limit?: number;
	}): Decision[] {
		return this.index.queryDecisions(opts);
	}

	/**
	 * Search decisions by text content.
	 */
	search(query: string, opts?: { project?: string; limit?: number }): Decision[] {
		return this.index.searchDecisions(query, opts);
	}

	/**
	 * Read all decisions from JSONL (slow, for sync/rebuild).
	 */
	readAll(): Decision[] {
		return readJsonlSync<Decision>(this.jsonlPath);
	}

	/**
	 * Rebuild SQLite index from JSONL source of truth.
	 */
	rebuildIndex(): number {
		const decisions = this.readAll();
		for (const d of decisions) {
			this.index.indexDecision(d);
		}
		return decisions.length;
	}
}
