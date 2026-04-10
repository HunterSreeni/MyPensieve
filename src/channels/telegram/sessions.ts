import type { Config } from "../../config/schema.js";
import { getProjectBinding } from "../../core/session.js";
import { GatewayDispatcher } from "../../gateway/dispatcher.js";
import { loadAllRoutingTables } from "../../gateway/routing-loader.js";
import { type ProjectState, closeProject, loadProject } from "../../projects/loader.js";
import { type SkillContext, createUnifiedExecutor } from "../../skills/executor.js";
import { createDefaultRegistry } from "../../skills/registry.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface PeerSession {
	peerId: string;
	binding: string;
	project: ProjectState;
	dispatcher: GatewayDispatcher;
	lastActivity: number;
	createdAt: number;
}

/**
 * Manages Telegram peer sessions.
 * One session per peer_id, with inactivity timeout.
 */
export class PeerSessionManager {
	private sessions = new Map<string, PeerSession>();
	private timeoutMs: number;
	private config: Config;
	private projectsDir?: string;

	constructor(config: Config, opts?: { timeoutMs?: number; projectsDir?: string }) {
		this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.config = config;
		this.projectsDir = opts?.projectsDir;
	}

	/**
	 * Check if a peer is allowed to use the bot.
	 * Returns false if allowed_peers is configured and peer is not in the list.
	 */
	isPeerAllowed(peerId: string): boolean {
		const telegramConfig = this.config.channels.telegram;
		const allowedPeers = (telegramConfig as { allowed_peers?: string[] }).allowed_peers ?? [];

		// If no allowed_peers configured, reject all (safe default)
		if (allowedPeers.length === 0) return false;

		return allowedPeers.includes(peerId);
	}

	/**
	 * Check if group messages are allowed.
	 */
	isGroupAllowed(): boolean {
		return (this.config.channels.telegram as { allow_groups?: boolean }).allow_groups ?? false;
	}

	/**
	 * Get or create a session for a peer.
	 * Throws if the peer is not in the allowed list.
	 */
	getOrCreate(peerId: string): PeerSession {
		if (!this.isPeerAllowed(peerId)) {
			throw new PeerNotAllowedError(peerId);
		}

		const existing = this.sessions.get(peerId);
		if (existing) {
			existing.lastActivity = Date.now();
			return existing;
		}

		const binding = getProjectBinding("telegram", peerId);
		const project = loadProject(binding, this.projectsDir);
		const registry = createDefaultRegistry();

		const ctx: SkillContext = {
			project,
			config: this.config,
			channelType: "telegram",
			sessionId: `telegram-${peerId}-${Date.now()}`,
		};

		const executor = createUnifiedExecutor(registry, ctx);
		const tables = loadAllRoutingTables();
		const dispatcher = new GatewayDispatcher(tables, executor);

		const session: PeerSession = {
			peerId,
			binding,
			project,
			dispatcher,
			lastActivity: Date.now(),
			createdAt: Date.now(),
		};

		this.sessions.set(peerId, session);
		return session;
	}

	/**
	 * Check if a peer has an active session.
	 */
	has(peerId: string): boolean {
		return this.sessions.has(peerId);
	}

	/**
	 * Close a specific peer session.
	 */
	close(peerId: string): void {
		const session = this.sessions.get(peerId);
		if (session) {
			closeProject(session.project);
			this.sessions.delete(peerId);
		}
	}

	/**
	 * Close sessions that have been inactive for longer than the timeout.
	 * Returns the number of sessions closed.
	 */
	reapInactive(): number {
		const now = Date.now();
		let reaped = 0;

		for (const [peerId, session] of this.sessions) {
			if (now - session.lastActivity > this.timeoutMs) {
				closeProject(session.project);
				this.sessions.delete(peerId);
				reaped++;
			}
		}

		return reaped;
	}

	/**
	 * Close all sessions (for daemon shutdown).
	 */
	closeAll(): void {
		for (const [, session] of this.sessions) {
			closeProject(session.project);
		}
		this.sessions.clear();
	}

	/**
	 * Get session count (for monitoring).
	 */
	count(): number {
		return this.sessions.size;
	}

	/**
	 * List all active peer IDs.
	 */
	activePeers(): string[] {
		return Array.from(this.sessions.keys());
	}
}

export class PeerNotAllowedError extends Error {
	constructor(public readonly peerId: string) {
		super(
			`Telegram peer '${peerId}' is not in the allowed_peers list. Add their Telegram user ID to config.channels.telegram.allowed_peers.`,
		);
		this.name = "PeerNotAllowedError";
	}
}
