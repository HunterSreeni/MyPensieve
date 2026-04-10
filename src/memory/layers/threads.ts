import crypto from "node:crypto";
import path from "node:path";
import { appendJsonl, readJsonlSync, writeJsonlAtomic } from "../../utils/jsonl.js";
import type { MemoryIndex } from "../sqlite-index.js";
import type { Thread, ThreadMessage, ThreadStatus, ThreadUpdate } from "../types.js";

/**
 * L2 Threads layer.
 * JSONL source of truth, SQLite index for fast status/project queries.
 */
export class ThreadsLayer {
	private jsonlPath: string;
	private index: MemoryIndex;

	constructor(projectDir: string, index: MemoryIndex) {
		this.jsonlPath = path.join(projectDir, "threads.jsonl");
		this.index = index;
	}

	createThread(opts: {
		project: string;
		title: string;
		firstMessage: ThreadMessage;
		tags?: string[];
	}): Thread {
		const now = new Date().toISOString();
		const thread: Thread = {
			id: `t-${crypto.randomUUID()}`,
			created_at: now,
			updated_at: now,
			project: opts.project,
			title: opts.title,
			status: "open",
			messages: [opts.firstMessage],
			tags: opts.tags ?? [],
		};

		appendJsonl(this.jsonlPath, thread);
		this.index.indexThread(thread);
		return thread;
	}

	applyUpdate(update: ThreadUpdate): Thread | null {
		const threads = this.readAll();

		if (update.thread_id === "new") {
			if (!update.title || !update.message) return null;
			return this.createThread({
				project: update.message.role === "operator" ? "default" : "default",
				title: update.title,
				firstMessage: update.message,
			});
		}

		const thread = threads.find((t) => t.id === update.thread_id);
		if (!thread) return null;

		thread.messages.push(update.message);
		thread.updated_at = new Date().toISOString();
		if (update.new_status) {
			thread.status = update.new_status;
		}

		// Rewrite JSONL with updated thread
		writeJsonlAtomic(this.jsonlPath, threads);
		this.index.indexThread(thread);
		return thread;
	}

	query(opts: { project?: string; status?: ThreadStatus; limit?: number }) {
		return this.index.queryThreads({
			project: opts.project,
			status: opts.status,
			limit: opts.limit,
		});
	}

	getThread(id: string): Thread | undefined {
		return this.readAll().find((t) => t.id === id);
	}

	readAll(): Thread[] {
		return readJsonlSync<Thread>(this.jsonlPath);
	}

	rebuildIndex(): number {
		const threads = this.readAll();
		for (const t of threads) {
			this.index.indexThread(t);
		}
		return threads.length;
	}
}
