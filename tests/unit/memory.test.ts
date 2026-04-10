import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryIndex } from "../../src/memory/sqlite-index.js";
import { DecisionsLayer } from "../../src/memory/layers/decisions.js";
import { ThreadsLayer } from "../../src/memory/layers/threads.js";
import { PersonaLayer } from "../../src/memory/layers/persona.js";
import { MemoryQuery } from "../../src/memory/query.js";
import { CheckpointManager } from "../../src/memory/checkpoint.js";

describe("MemoryIndex (SQLite)", () => {
	let index: MemoryIndex;

	beforeEach(() => {
		index = new MemoryIndex(":memory:");
	});

	afterEach(() => {
		index.close();
	});

	it("starts with empty stats", () => {
		const stats = index.getStats();
		expect(stats.decisions).toBe(0);
		expect(stats.threads).toBe(0);
		expect(stats.persona_deltas).toBe(0);
	});

	it("indexes and queries decisions", () => {
		index.indexDecision({
			id: "d1",
			timestamp: "2026-04-10T12:00:00Z",
			session_id: "s1",
			project: "test",
			content: "Use SQLite because fast",
			confidence: 0.95,
			source: "manual",
			tags: ["arch"],
		});

		const results = index.queryDecisions({ project: "test" });
		expect(results).toHaveLength(1);
		expect(results[0]?.content).toBe("Use SQLite because fast");
	});

	it("filters decisions by confidence", () => {
		index.indexDecision({
			id: "d1", timestamp: "2026-04-10T12:00:00Z", session_id: "s1",
			project: "test", content: "high", confidence: 0.95, source: "manual", tags: [],
		});
		index.indexDecision({
			id: "d2", timestamp: "2026-04-10T12:00:00Z", session_id: "s1",
			project: "test", content: "low", confidence: 0.5, source: "auto", tags: [],
		});

		const high = index.queryDecisions({ minConfidence: 0.9 });
		expect(high).toHaveLength(1);
		expect(high[0]?.content).toBe("high");
	});

	it("searches decisions by text", () => {
		index.indexDecision({
			id: "d1", timestamp: "2026-04-10T12:00:00Z", session_id: "s1",
			project: "test", content: "Use SQLite for indexing", confidence: 0.95, source: "manual", tags: [],
		});
		index.indexDecision({
			id: "d2", timestamp: "2026-04-10T12:00:00Z", session_id: "s1",
			project: "test", content: "Use Zod for validation", confidence: 0.65, source: "auto", tags: [],
		});

		const results = index.searchDecisions("SQLite");
		expect(results).toHaveLength(1);
	});

	it("indexes and queries threads", () => {
		index.indexThread({
			id: "t1", created_at: "2026-04-10T12:00:00Z", updated_at: "2026-04-10T13:00:00Z",
			project: "test", title: "Auth design", status: "open",
			messages: [{ timestamp: "2026-04-10T12:00:00Z", session_id: "s1", role: "operator", content: "msg" }],
			tags: [],
		});

		const open = index.queryThreads({ status: "open" });
		expect(open).toHaveLength(1);
		expect(open[0]?.title).toBe("Auth design");
	});

	it("indexes and queries persona deltas", () => {
		index.indexPersonaDelta({
			id: "pd1", timestamp: "2026-04-10T12:00:00Z", session_id: "s1",
			field: "communication_style", delta_type: "update",
			content: "prefers terse responses", confidence: 0.8, applied: false,
		});

		const pending = index.queryPendingDeltas();
		expect(pending).toHaveLength(1);

		index.markDeltaApplied("pd1");
		const afterApply = index.queryPendingDeltas();
		expect(afterApply).toHaveLength(0);
	});

	it("is idempotent on INSERT OR REPLACE", () => {
		const d = {
			id: "d1", timestamp: "2026-04-10T12:00:00Z", session_id: "s1",
			project: "test", content: "original", confidence: 0.95, source: "manual" as const, tags: [],
		};
		index.indexDecision(d);
		index.indexDecision({ ...d, content: "updated" });

		const results = index.queryDecisions({});
		expect(results).toHaveLength(1);
		expect(results[0]?.content).toBe("updated");
	});
});

describe("DecisionsLayer (L1)", () => {
	let tmpDir: string;
	let index: MemoryIndex;
	let layer: DecisionsLayer;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-l1-"));
		index = new MemoryIndex(":memory:");
		layer = new DecisionsLayer(tmpDir, index);
	});

	afterEach(() => {
		index.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("adds a decision and queries it back", () => {
		layer.addDecision({
			sessionId: "s1", project: "test",
			content: "Use Pi as foundation because it covers 70% of our needs",
			confidence: 0.95, source: "manual", tags: ["architecture"],
		});

		const results = layer.query({ project: "test" });
		expect(results).toHaveLength(1);
		expect(results[0]?.content).toContain("Pi as foundation");
	});

	it("writes to JSONL and can rebuild index", () => {
		layer.addDecision({
			sessionId: "s1", project: "test",
			content: "decision 1", confidence: 0.95, source: "manual",
		});
		layer.addDecision({
			sessionId: "s1", project: "test",
			content: "decision 2", confidence: 0.65, source: "auto",
		});

		const raw = layer.readAll();
		expect(raw).toHaveLength(2);

		// Simulate index rebuild
		const newIndex = new MemoryIndex(":memory:");
		const newLayer = new DecisionsLayer(tmpDir, newIndex);
		const count = newLayer.rebuildIndex();
		expect(count).toBe(2);

		const rebuilt = newLayer.query({});
		expect(rebuilt).toHaveLength(2);
		newIndex.close();
	});

	it("searches decisions by content", () => {
		layer.addDecision({ sessionId: "s1", project: "test", content: "Use SQLite", confidence: 0.95, source: "manual" });
		layer.addDecision({ sessionId: "s1", project: "test", content: "Use Zod", confidence: 0.65, source: "auto" });

		const results = layer.search("SQLite");
		expect(results).toHaveLength(1);
	});
});

describe("ThreadsLayer (L2)", () => {
	let tmpDir: string;
	let index: MemoryIndex;
	let layer: ThreadsLayer;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-l2-"));
		index = new MemoryIndex(":memory:");
		layer = new ThreadsLayer(tmpDir, index);
	});

	afterEach(() => {
		index.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates a thread and queries it", () => {
		const thread = layer.createThread({
			project: "test",
			title: "Auth middleware design",
			firstMessage: { timestamp: "2026-04-10T12:00:00Z", session_id: "s1", role: "operator", content: "How should we handle auth?" },
		});

		expect(thread.id).toBeDefined();
		expect(thread.status).toBe("open");

		const results = layer.query({ status: "open" });
		expect(results).toHaveLength(1);
	});

	it("applies thread updates", () => {
		const thread = layer.createThread({
			project: "test",
			title: "Auth thread",
			firstMessage: { timestamp: "2026-04-10T12:00:00Z", session_id: "s1", role: "operator", content: "start" },
		});

		layer.applyUpdate({
			thread_id: thread.id,
			message: { timestamp: "2026-04-10T13:00:00Z", session_id: "s1", role: "agent", content: "reply" },
		});

		const updated = layer.getThread(thread.id);
		expect(updated?.messages).toHaveLength(2);
	});

	it("closes a thread via update", () => {
		const thread = layer.createThread({
			project: "test",
			title: "Temp thread",
			firstMessage: { timestamp: "2026-04-10T12:00:00Z", session_id: "s1", role: "operator", content: "done" },
		});

		layer.applyUpdate({
			thread_id: thread.id,
			message: { timestamp: "2026-04-10T14:00:00Z", session_id: "s1", role: "operator", content: "closing" },
			new_status: "closed",
		});

		const closed = layer.query({ status: "closed" });
		expect(closed).toHaveLength(1);
	});
});

describe("PersonaLayer (L3)", () => {
	let tmpDir: string;
	let index: MemoryIndex;
	let layer: PersonaLayer;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-l3-"));
		index = new MemoryIndex(":memory:");
		layer = new PersonaLayer(tmpDir, index);
	});

	afterEach(() => {
		index.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("adds a persona delta", () => {
		const delta = layer.addDelta({
			sessionId: "s1",
			field: "communication_style",
			deltaType: "update",
			content: "prefers terse responses",
			confidence: 0.8,
		});

		expect(delta.id).toBeDefined();
		expect(delta.applied).toBe(false);
	});

	it("gets pending deltas capped at limit", () => {
		for (let i = 0; i < 5; i++) {
			layer.addDelta({
				sessionId: "s1", field: `field_${i}`,
				deltaType: "add", content: `delta ${i}`, confidence: 0.7,
			});
		}

		const pending = layer.getPending(3);
		expect(pending).toHaveLength(3);
	});

	it("marks deltas as applied", () => {
		const delta = layer.addDelta({
			sessionId: "s1", field: "style",
			deltaType: "update", content: "terse", confidence: 0.8,
		});

		layer.markApplied(delta.id);
		const pending = layer.getPending();
		expect(pending).toHaveLength(0);
	});
});

describe("MemoryQuery (unified recall)", () => {
	let tmpDir: string;
	let index: MemoryIndex;
	let decisions: DecisionsLayer;
	let threads: ThreadsLayer;
	let persona: PersonaLayer;
	let query: MemoryQuery;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-query-"));
		index = new MemoryIndex(":memory:");
		decisions = new DecisionsLayer(tmpDir, index);
		threads = new ThreadsLayer(tmpDir, index);
		persona = new PersonaLayer(tmpDir, index);
		query = new MemoryQuery(decisions, threads, persona);
	});

	afterEach(() => {
		index.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("searches across all layers", () => {
		decisions.addDecision({ sessionId: "s1", project: "test", content: "Use SQLite for memory", confidence: 0.95, source: "manual" });
		threads.createThread({
			project: "test", title: "SQLite vs Redis discussion",
			firstMessage: { timestamp: "2026-04-10T12:00:00Z", session_id: "s1", role: "operator", content: "thinking about SQLite" },
		});
		persona.addDelta({ sessionId: "s1", field: "tech_preference", deltaType: "add", content: "prefers SQLite", confidence: 0.7 });

		const results = query.recall({ query: "SQLite" });
		expect(results.length).toBeGreaterThanOrEqual(3);
		expect(results.some((r) => r.layer === "decisions")).toBe(true);
		expect(results.some((r) => r.layer === "threads")).toBe(true);
		expect(results.some((r) => r.layer === "persona")).toBe(true);
	});

	it("filters by layer", () => {
		decisions.addDecision({ sessionId: "s1", project: "test", content: "Use SQLite", confidence: 0.95, source: "manual" });
		persona.addDelta({ sessionId: "s1", field: "tech", deltaType: "add", content: "likes SQLite", confidence: 0.7 });

		const decisionsOnly = query.recall({ query: "SQLite", layers: ["decisions"] });
		expect(decisionsOnly.every((r) => r.layer === "decisions")).toBe(true);
	});

	it("respects limit", () => {
		for (let i = 0; i < 10; i++) {
			decisions.addDecision({ sessionId: "s1", project: "test", content: `decision ${i} about config`, confidence: 0.8, source: "auto" });
		}

		const limited = query.recall({ query: "config", limit: 3 });
		expect(limited).toHaveLength(3);
	});

	it("returns empty for no matches", () => {
		const results = query.recall({ query: "nonexistent_xyz_123" });
		expect(results).toHaveLength(0);
	});
});

describe("CheckpointManager", () => {
	let tmpDir: string;
	let checkpointPath: string;
	let manager: CheckpointManager;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mypensieve-checkpoint-"));
		checkpointPath = path.join(tmpDir, "state", "extractor-checkpoint.json");
		manager = new CheckpointManager(checkpointPath);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when no checkpoint exists", () => {
		expect(manager.read()).toBeNull();
	});

	it("writes and reads a checkpoint", () => {
		manager.write({
			last_processed_session_id: "session-42",
			last_processed_timestamp: "2026-04-10T02:00:00Z",
			total_sessions_processed: 42,
			last_run_status: "success",
		});

		const checkpoint = manager.read();
		expect(checkpoint).not.toBeNull();
		expect(checkpoint?.last_processed_session_id).toBe("session-42");
		expect(checkpoint?.total_sessions_processed).toBe(42);
	});

	it("checks if a session was processed", () => {
		manager.write({
			last_processed_session_id: "session-050",
			last_processed_timestamp: "2026-04-10T02:00:00Z",
			total_sessions_processed: 50,
			last_run_status: "success",
		});

		expect(manager.isProcessed("session-050")).toBe(true);
		expect(manager.isProcessed("session-040")).toBe(true);
		expect(manager.isProcessed("session-060")).toBe(false);
	});

	it("resets checkpoint", () => {
		manager.write({
			last_processed_session_id: "s1",
			last_processed_timestamp: "2026-04-10T02:00:00Z",
			total_sessions_processed: 1,
			last_run_status: "success",
		});

		manager.reset();
		expect(manager.read()).toBeNull();
	});
});
