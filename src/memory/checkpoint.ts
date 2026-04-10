import fs from "node:fs";
import type { ExtractorCheckpoint } from "./types.js";

/**
 * Manage the extractor checkpoint for idempotent session processing.
 * Checkpoint tracks the last successfully processed session ID.
 */
export class CheckpointManager {
	private checkpointPath: string;

	constructor(checkpointPath: string) {
		this.checkpointPath = checkpointPath;
	}

	/**
	 * Read the current checkpoint. Returns null if no checkpoint exists.
	 */
	read(): ExtractorCheckpoint | null {
		if (!fs.existsSync(this.checkpointPath)) return null;

		try {
			const raw = fs.readFileSync(this.checkpointPath, "utf-8");
			return JSON.parse(raw) as ExtractorCheckpoint;
		} catch {
			return null;
		}
	}

	/**
	 * Write a checkpoint after successful processing.
	 * Atomic write (temp + rename).
	 */
	write(checkpoint: ExtractorCheckpoint): void {
		fs.mkdirSync(require("node:path").dirname(this.checkpointPath), { recursive: true });
		const tmpPath = `${this.checkpointPath}.tmp`;
		fs.writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2), "utf-8");
		fs.renameSync(tmpPath, this.checkpointPath);
	}

	/**
	 * Reset the checkpoint (for recovery: reprocess all sessions).
	 */
	reset(): void {
		if (fs.existsSync(this.checkpointPath)) {
			fs.unlinkSync(this.checkpointPath);
		}
	}

	/**
	 * Check if a session has already been processed.
	 */
	isProcessed(sessionId: string): boolean {
		const checkpoint = this.read();
		if (!checkpoint) return false;
		// Simple comparison - assumes session IDs are sortable/comparable
		return checkpoint.last_processed_session_id >= sessionId;
	}
}
