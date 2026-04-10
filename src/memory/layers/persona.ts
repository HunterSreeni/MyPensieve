import crypto from "node:crypto";
import path from "node:path";
import { appendJsonl, readJsonlSync } from "../../utils/jsonl.js";
import type { MemoryIndex } from "../sqlite-index.js";
import type { PersonaDelta } from "../types.js";

/**
 * L3 Persona layer.
 * Tracks deltas (changes to operator/LLM persona) from session extraction.
 * Deltas accumulate until the nightly synthesizer applies them.
 */
export class PersonaLayer {
	private jsonlPath: string;
	private index: MemoryIndex;

	constructor(projectDir: string, index: MemoryIndex) {
		this.jsonlPath = path.join(projectDir, "persona-deltas.jsonl");
		this.index = index;
	}

	addDelta(opts: {
		sessionId: string;
		field: string;
		deltaType: "add" | "update" | "contradict";
		content: string;
		confidence: number;
	}): PersonaDelta {
		const delta: PersonaDelta = {
			id: `pd-${crypto.randomUUID()}`,
			timestamp: new Date().toISOString(),
			session_id: opts.sessionId,
			field: opts.field,
			delta_type: opts.deltaType,
			content: opts.content,
			confidence: opts.confidence,
			applied: false,
		};

		appendJsonl(this.jsonlPath, delta);
		this.index.indexPersonaDelta(delta);
		return delta;
	}

	/**
	 * Get pending (unapplied) deltas, capped at limit.
	 * MVP caps at 3 per day to avoid noise.
	 */
	getPending(limit = 3): PersonaDelta[] {
		return this.index.queryPendingDeltas(limit);
	}

	/**
	 * Mark a delta as applied (after synthesizer merges it into persona file).
	 */
	markApplied(id: string): void {
		this.index.markDeltaApplied(id);
	}

	readAll(): PersonaDelta[] {
		return readJsonlSync<PersonaDelta>(this.jsonlPath);
	}

	rebuildIndex(): number {
		const deltas = this.readAll();
		for (const d of deltas) {
			this.index.indexPersonaDelta(d);
		}
		return deltas.length;
	}
}
