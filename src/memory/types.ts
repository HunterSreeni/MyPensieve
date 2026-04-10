// --- L1: Decisions ---

export interface Decision {
	id: string;
	timestamp: string; // ISO
	session_id: string;
	project: string;
	content: string; // "X because Y"
	confidence: number; // 0.95 for manual /decide, 0.65 for auto-detected
	source: "manual" | "auto";
	tags: string[];
	supersedes?: string; // ID of a prior decision this overrides
}

// --- L2: Threads ---

export type ThreadStatus = "open" | "closed" | "stale";

export interface Thread {
	id: string;
	created_at: string; // ISO
	updated_at: string; // ISO
	project: string;
	title: string;
	status: ThreadStatus;
	messages: ThreadMessage[];
	tags: string[];
}

export interface ThreadMessage {
	timestamp: string;
	session_id: string;
	role: "operator" | "agent" | "system";
	content: string;
}

// --- L3: Persona ---

export interface PersonaDelta {
	id: string;
	timestamp: string; // ISO
	session_id: string;
	field: string; // which persona field this affects
	delta_type: "add" | "update" | "contradict";
	content: string;
	confidence: number;
	applied: boolean; // whether synthesizer has merged this into persona file
	contradiction_check?: {
		is_contradiction: boolean;
		confidence: number;
		explanation: string;
	};
}

// --- L4: Semantic (embedding-based) ---

export interface SemanticEntry {
	id: string;
	timestamp: string;
	project: string;
	content: string;
	embedding?: number[]; // populated when embeddings are enabled
	source_layer: "decisions" | "threads" | "persona" | "journal";
	source_id: string;
}

// --- Extractor checkpoint ---

export interface ExtractorCheckpoint {
	last_processed_session_id: string;
	last_processed_timestamp: string; // ISO
	total_sessions_processed: number;
	last_run_status: "success" | "partial" | "failed";
	last_run_error?: string;
}

// --- Extractor output ---

export interface ExtractionResult {
	session_id: string;
	timestamp: string;
	decisions: Decision[];
	thread_updates: ThreadUpdate[];
	persona_deltas: PersonaDelta[];
}

export interface ThreadUpdate {
	thread_id: string; // existing thread ID, or "new" to create
	title?: string; // for new threads
	message: ThreadMessage;
	new_status?: ThreadStatus;
}

// --- Daily log entry (L1 adjacent, stored in project) ---

export interface DailyLogEntry {
	date: string; // YYYY-MM-DD
	timestamp: string; // ISO
	project: string;
	wins: string[];
	blockers: string[];
	mood_score: number; // 1-5
	mood_text: string;
	energy_score: number; // 1-5
	energy_text: string;
	remember_tomorrow: string;
	weekly_review_flag: boolean;
	digest: DailyDigest;
}

export interface DailyDigest {
	decisions_count: number;
	open_threads_count: number;
	cost_summary: Record<string, number>; // tier -> cost
	errors_count: number;
	sessions_count: number;
}

// --- Council result ---

export interface CouncilResult {
	deliberation_id: string;
	timestamp: string;
	topic: string;
	agents: string[];
	phases_completed: number;
	total_rounds: number;
	synthesis: string;
	consensus: boolean;
	dissent: string[]; // "agent:name - concern..."
	recommendations: string[];
	structured_channels: Record<string, string>; // researchFindings, critiques, draft
}

// --- Council checkpoint ---

export interface CouncilCheckpoint {
	deliberation_id: string;
	phase: string;
	agent: string;
	turn_number: number;
	content_hash: string;
	timestamp: string;
}
