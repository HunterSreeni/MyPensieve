/**
 * Memory extraction Phase 3 - synthesizer.
 *
 * Runs after the primary extractor to consolidate its output:
 *   - De-duplicates decisions whose normalized content is identical
 *   - Groups persona deltas by field into a compact per-field summary
 *
 * Pure functions here. The caller wires I/O (CLI, extractor echo, etc.).
 */
import type { Decision, PersonaDelta } from "./types.js";

export interface DuplicateGroup {
	keeper_id: string;
	duplicate_ids: string[];
	merged_tags: string[];
}

export interface DecisionSynthesisResult {
	/** Canonical decision set, one entry per unique normalized content. */
	canonical: Decision[];
	/** Duplicate clusters (for audit / display). */
	duplicates: DuplicateGroup[];
}

/** Normalize decision content for equality comparison. Lowercase, collapse whitespace, trim punctuation. */
export function normalizeDecisionContent(content: string): string {
	return content
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/[.!?;:]+$/, "")
		.trim();
}

/**
 * De-duplicate decisions by normalized content. Keeps the most recent entry
 * in each duplicate group, merging tags across the group. Stable order.
 */
export function synthesizeDecisions(decisions: Decision[]): DecisionSynthesisResult {
	const groups = new Map<string, Decision[]>();
	for (const d of decisions) {
		const key = normalizeDecisionContent(d.content);
		if (!key) continue;
		const bucket = groups.get(key);
		if (bucket) bucket.push(d);
		else groups.set(key, [d]);
	}

	const canonical: Decision[] = [];
	const duplicates: DuplicateGroup[] = [];
	for (const [, bucket] of groups) {
		// Sort newest-first by timestamp
		bucket.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		const keeper = bucket[0];
		if (!keeper) continue;
		const mergedTags = Array.from(new Set(bucket.flatMap((b) => b.tags)));
		const canonicalEntry: Decision = { ...keeper, tags: mergedTags };
		canonical.push(canonicalEntry);
		if (bucket.length > 1) {
			duplicates.push({
				keeper_id: keeper.id,
				duplicate_ids: bucket.slice(1).map((b) => b.id),
				merged_tags: mergedTags,
			});
		}
	}
	// Stable output order: sort canonical by timestamp descending
	canonical.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	return { canonical, duplicates };
}

export interface PersonaSynthesisResult {
	/**
	 * Aggregated per-field summary. Each entry contains the concatenated content
	 * of all unapplied deltas in that field, ordered newest-first.
	 */
	by_field: Record<string, string[]>;
	/** Delta IDs that were consumed - callers should mark these applied. */
	applied_ids: string[];
}

/**
 * Consolidate pending persona deltas into a per-field map. Only deltas with
 * `applied === false` are synthesized. The caller is responsible for marking
 * the returned `applied_ids` as applied in the index.
 */
export function synthesizePersonaDeltas(deltas: PersonaDelta[]): PersonaSynthesisResult {
	const pending = deltas.filter((d) => !d.applied);
	pending.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

	const byField: Record<string, string[]> = {};
	const appliedIds: string[] = [];
	for (const d of pending) {
		const bucket = byField[d.field] ?? [];
		bucket.push(d.content);
		byField[d.field] = bucket;
		appliedIds.push(d.id);
	}
	return { by_field: byField, applied_ids: appliedIds };
}
