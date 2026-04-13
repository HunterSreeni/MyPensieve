import Database from "better-sqlite3";
import type { DailyLogEntry, Decision, PersonaDelta, Thread } from "./types.js";

/**
 * SQLite derived index for fast queries across memory layers.
 * Source of truth is always the JSONL files - this is a read-optimized index.
 *
 * Uses WAL mode for concurrent read safety.
 */
export class MemoryIndex {
	private db: Database.Database;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("foreign_keys = ON");
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS decisions (
				id TEXT PRIMARY KEY,
				timestamp TEXT NOT NULL,
				session_id TEXT NOT NULL,
				project TEXT NOT NULL,
				content TEXT NOT NULL,
				confidence REAL NOT NULL,
				source TEXT NOT NULL CHECK(source IN ('manual', 'auto')),
				tags TEXT NOT NULL DEFAULT '[]',
				supersedes TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project);
			CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp);
			CREATE INDEX IF NOT EXISTS idx_decisions_confidence ON decisions(confidence);

			CREATE TABLE IF NOT EXISTS threads (
				id TEXT PRIMARY KEY,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				project TEXT NOT NULL,
				title TEXT NOT NULL,
				status TEXT NOT NULL CHECK(status IN ('open', 'closed', 'stale')),
				tags TEXT NOT NULL DEFAULT '[]',
				message_count INTEGER NOT NULL DEFAULT 0
			);

			CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project);
			CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);

			CREATE TABLE IF NOT EXISTS persona_deltas (
				id TEXT PRIMARY KEY,
				timestamp TEXT NOT NULL,
				session_id TEXT NOT NULL,
				field TEXT NOT NULL,
				delta_type TEXT NOT NULL CHECK(delta_type IN ('add', 'update', 'contradict')),
				content TEXT NOT NULL,
				confidence REAL NOT NULL,
				applied INTEGER NOT NULL DEFAULT 0,
				is_contradiction INTEGER NOT NULL DEFAULT 0,
				contradiction_confidence REAL
			);

			CREATE INDEX IF NOT EXISTS idx_persona_deltas_applied ON persona_deltas(applied);
			CREATE INDEX IF NOT EXISTS idx_persona_deltas_field ON persona_deltas(field);

			CREATE TABLE IF NOT EXISTS daily_logs (
				date TEXT PRIMARY KEY,
				timestamp TEXT NOT NULL,
				project TEXT NOT NULL,
				mood_score INTEGER,
				energy_score INTEGER,
				wins_count INTEGER NOT NULL DEFAULT 0,
				blockers_count INTEGER NOT NULL DEFAULT 0,
				weekly_review_flag INTEGER NOT NULL DEFAULT 0
			);

			CREATE INDEX IF NOT EXISTS idx_daily_logs_project ON daily_logs(project);
		`);
	}

	// --- Decisions ---

	indexDecision(d: Decision): void {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO decisions (id, timestamp, session_id, project, content, confidence, source, tags, supersedes)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				d.id,
				d.timestamp,
				d.session_id,
				d.project,
				d.content,
				d.confidence,
				d.source,
				JSON.stringify(d.tags),
				d.supersedes ?? null,
			);
	}

	queryDecisions(opts: {
		project?: string;
		since?: string;
		minConfidence?: number;
		limit?: number;
	}): Decision[] {
		let sql = "SELECT * FROM decisions WHERE 1=1";
		const params: unknown[] = [];

		if (opts.project) {
			sql += " AND project = ?";
			params.push(opts.project);
		}
		if (opts.since) {
			sql += " AND timestamp >= ?";
			params.push(opts.since);
		}
		if (opts.minConfidence !== undefined) {
			sql += " AND confidence >= ?";
			params.push(opts.minConfidence);
		}

		sql += " ORDER BY timestamp DESC";

		if (opts.limit) {
			sql += " LIMIT ?";
			params.push(opts.limit);
		}

		const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
		return rows.map(rowToDecision);
	}

	// --- Threads ---

	indexThread(t: Thread): void {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO threads (id, created_at, updated_at, project, title, status, tags, message_count)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				t.id,
				t.created_at,
				t.updated_at,
				t.project,
				t.title,
				t.status,
				JSON.stringify(t.tags),
				t.messages.length,
			);
	}

	queryThreads(opts: {
		project?: string;
		status?: string;
		limit?: number;
	}): Array<Omit<Thread, "messages"> & { message_count: number }> {
		let sql = "SELECT * FROM threads WHERE 1=1";
		const params: unknown[] = [];

		if (opts.project) {
			sql += " AND project = ?";
			params.push(opts.project);
		}
		if (opts.status) {
			sql += " AND status = ?";
			params.push(opts.status);
		}

		sql += " ORDER BY updated_at DESC";

		if (opts.limit) {
			sql += " LIMIT ?";
			params.push(opts.limit);
		}

		const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
		return rows.map((row) => ({
			id: row.id as string,
			created_at: row.created_at as string,
			updated_at: row.updated_at as string,
			project: row.project as string,
			title: row.title as string,
			status: row.status as Thread["status"],
			tags: JSON.parse(row.tags as string) as string[],
			messages: [],
			message_count: row.message_count as number,
		}));
	}

	// --- Persona Deltas ---

	indexPersonaDelta(d: PersonaDelta): void {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO persona_deltas (id, timestamp, session_id, field, delta_type, content, confidence, applied, is_contradiction, contradiction_confidence)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				d.id,
				d.timestamp,
				d.session_id,
				d.field,
				d.delta_type,
				d.content,
				d.confidence,
				d.applied ? 1 : 0,
				d.contradiction_check?.is_contradiction ? 1 : 0,
				d.contradiction_check?.confidence ?? null,
			);
	}

	queryPendingDeltas(limit?: number): PersonaDelta[] {
		let sql = "SELECT * FROM persona_deltas WHERE applied = 0 ORDER BY timestamp ASC";
		const params: unknown[] = [];
		if (limit) {
			sql += " LIMIT ?";
			params.push(limit);
		}
		const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
		return rows.map(rowToPersonaDelta);
	}

	markDeltaApplied(id: string): void {
		this.db.prepare("UPDATE persona_deltas SET applied = 1 WHERE id = ?").run(id);
	}

	// --- Daily Logs ---

	indexDailyLog(entry: DailyLogEntry): void {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO daily_logs (date, timestamp, project, mood_score, energy_score, wins_count, blockers_count, weekly_review_flag)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				entry.date,
				entry.timestamp,
				entry.project,
				entry.mood_score,
				entry.energy_score,
				entry.wins.length,
				entry.blockers.length,
				entry.weekly_review_flag ? 1 : 0,
			);
	}

	queryMoodTrends(opts: { project?: string; days?: number }): {
		avg_mood: number | null;
		avg_energy: number | null;
		period_days: number;
	} {
		const days = opts.days ?? 30;
		const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

		let sql =
			"SELECT AVG(mood_score) as avg_mood, AVG(energy_score) as avg_energy, COUNT(*) as count FROM daily_logs WHERE date >= ?";
		const params: unknown[] = [since];

		if (opts.project) {
			sql += " AND project = ?";
			params.push(opts.project);
		}

		const row = this.db.prepare(sql).get(...params) as Record<string, unknown>;
		return {
			avg_mood: row.avg_mood as number | null,
			avg_energy: row.avg_energy as number | null,
			period_days: days,
		};
	}

	// --- Full-text search across decisions ---

	searchDecisions(query: string, opts?: { project?: string; limit?: number }): Decision[] {
		// Escape LIKE wildcards in user input to prevent wildcard injection
		const escaped = query.replace(/[%_\\]/g, "\\$&");
		let sql = "SELECT * FROM decisions WHERE content LIKE ? ESCAPE '\\'";
		const params: unknown[] = [`%${escaped}%`];

		if (opts?.project) {
			sql += " AND project = ?";
			params.push(opts.project);
		}

		sql += " ORDER BY timestamp DESC";

		if (opts?.limit) {
			sql += " LIMIT ?";
			params.push(opts.limit);
		}

		const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
		return rows.map(rowToDecision);
	}

	// --- Stats ---

	getStats(): {
		decisions: number;
		threads: number;
		open_threads: number;
		persona_deltas: number;
		pending_deltas: number;
		daily_logs: number;
	} {
		const decisions = (
			this.db.prepare("SELECT COUNT(*) as c FROM decisions").get() as { c: number }
		).c;
		const threads = (this.db.prepare("SELECT COUNT(*) as c FROM threads").get() as { c: number }).c;
		const openThreads = (
			this.db.prepare("SELECT COUNT(*) as c FROM threads WHERE status = 'open'").get() as {
				c: number;
			}
		).c;
		const personaDeltas = (
			this.db.prepare("SELECT COUNT(*) as c FROM persona_deltas").get() as { c: number }
		).c;
		const pendingDeltas = (
			this.db.prepare("SELECT COUNT(*) as c FROM persona_deltas WHERE applied = 0").get() as {
				c: number;
			}
		).c;
		const dailyLogs = (
			this.db.prepare("SELECT COUNT(*) as c FROM daily_logs").get() as { c: number }
		).c;

		return {
			decisions,
			threads,
			open_threads: openThreads,
			persona_deltas: personaDeltas,
			pending_deltas: pendingDeltas,
			daily_logs: dailyLogs,
		};
	}

	close(): void {
		this.db.close();
	}
}

// --- Row conversion helpers ---

function rowToDecision(row: Record<string, unknown>): Decision {
	return {
		id: row.id as string,
		timestamp: row.timestamp as string,
		session_id: row.session_id as string,
		project: row.project as string,
		content: row.content as string,
		confidence: row.confidence as number,
		source: row.source as "manual" | "auto",
		tags: JSON.parse(row.tags as string) as string[],
		supersedes: row.supersedes as string | undefined,
	};
}

function rowToPersonaDelta(row: Record<string, unknown>): PersonaDelta {
	return {
		id: row.id as string,
		timestamp: row.timestamp as string,
		session_id: row.session_id as string,
		field: row.field as string,
		delta_type: row.delta_type as "add" | "update" | "contradict",
		content: row.content as string,
		confidence: row.confidence as number,
		applied: (row.applied as number) === 1,
		contradiction_check:
			row.is_contradiction !== null
				? {
						is_contradiction: (row.is_contradiction as number) === 1,
						confidence: row.contradiction_confidence as number,
						explanation: "",
					}
				: undefined,
	};
}
