/**
 * Telegram channel listener.
 *
 * Connects to Telegram via grammy (long-polling), enforces the allowlist,
 * and routes messages through Pi agent sessions - one session per peer.
 *
 * Usage: `mypensieve start --channel telegram`
 */
import fs from "node:fs";
import path from "node:path";
import {
	AuthStorage,
	SessionManager,
	codingTools,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "@mariozechner/pi-coding-agent";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { Bot } from "grammy";

import { ConfigReadError, readConfig } from "../../config/index.js";
import { PI_DIRS, SECRETS_DIR } from "../../config/paths.js";
import { parseModelString, resolveDefaultModel } from "../../config/schema.js";
import { createToolGuard } from "../../core/security/tool-guard.js";
import { savePersonaTool } from "../../core/tools/persona-tool.js";
import { validateChannelBinding } from "../../gateway/binding-validator.js";
import { isPersonaTemplate } from "../../init/persona-templates.js";
import { captureError, withCapture } from "../../ops/index.js";
import { getOllamaHost, registerOllamaProvider } from "../../providers/ollama.js";
import { chunkMessage, sanitizeOutput, toTelegramMarkdown } from "./formatter.js";
import { PeerRateLimiter } from "./rate-limiter.js";

/** Max message length accepted from Telegram (chars). */
const MAX_INPUT_LENGTH = 2000;
/** Max concurrent agent sessions across all peers. */
const MAX_CONCURRENT_SESSIONS = 5;

interface TelegramSecrets {
	bot_token: string;
}

interface PeerAgent {
	session: AgentSession;
	lastActivity: number;
}

/**
 * Read the Telegram bot token from secrets.
 */
function readTelegramSecrets(): TelegramSecrets {
	const secretsPath = path.join(SECRETS_DIR, "telegram.json");

	if (!fs.existsSync(secretsPath)) {
		throw new Error(
			`Telegram secrets not found at ${secretsPath}.\nRun 'mypensieve init --restart' and enable Telegram to set your bot token.`,
		);
	}

	// Check secrets file permissions
	try {
		const dirStat = fs.statSync(path.dirname(secretsPath));
		const dirMode = dirStat.mode & 0o777;
		if (dirMode !== 0o700) {
			console.warn(
				`[mypensieve] WARNING: Secrets directory has mode ${dirMode.toString(8)}, expected 700. ` +
					`Run: chmod 700 ${path.dirname(secretsPath)}`,
			);
		}
		const fileStat = fs.statSync(secretsPath);
		const fileMode = fileStat.mode & 0o777;
		if (fileMode !== 0o600) {
			console.warn(
				`[mypensieve] WARNING: Secrets file has mode ${fileMode.toString(8)}, expected 600. ` +
					`Run: chmod 600 ${secretsPath}`,
			);
		}
	} catch {
		// stat failed - will be caught by readFileSync below
	}

	const raw = fs.readFileSync(secretsPath, "utf-8");
	const parsed = JSON.parse(raw) as Record<string, unknown>;

	if (!parsed.bot_token || typeof parsed.bot_token !== "string") {
		throw new Error(
			`Invalid telegram.json: missing or empty 'bot_token' field.\n` +
				"Edit ~/.mypensieve/.secrets/telegram.json and add your bot token.",
		);
	}

	return { bot_token: parsed.bot_token };
}

/**
 * Start the Telegram bot listener.
 *
 * Flow:
 *   1. Load config + validate Telegram channel is enabled
 *   2. Read bot token from secrets
 *   3. Create grammy bot with long-polling
 *   4. On each message: enforce allowlist, get/create Pi agent session, prompt, reply
 */
export async function startTelegramListener(opts?: { configPath?: string }): Promise<void> {
	// Step 1: Load config
	let config: import("../../config/schema.js").Config;
	try {
		config = readConfig(opts?.configPath);
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "config_read",
			errorSrc: "telegram:config",
			message: e.message,
			stack: e.stack,
			context: { configPath: opts?.configPath ?? "default" },
		});
		if (err instanceof ConfigReadError) {
			console.error(err.message);
			console.error("Run 'mypensieve init' to set up your configuration.");
			process.exitCode = 1;
			return;
		}
		throw err;
	}

	// Step 2: Validate Telegram channel is enabled
	try {
		validateChannelBinding("telegram", config.channels);
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "channel_validation",
			errorSrc: "telegram:channel",
			message: e.message,
			stack: e.stack,
			context: { channel: "telegram" },
		});
		console.error("Telegram channel validation failed:", e.message);
		process.exitCode = 1;
		return;
	}

	if (!config.channels.telegram.enabled) {
		console.error(
			"Telegram channel is not enabled in config.\n" +
				"Run 'mypensieve init --restart' and enable Telegram.",
		);
		process.exitCode = 1;
		return;
	}

	// Step 3: Resolve model
	let modelString: string;
	let provider: string;
	let modelId: string;
	try {
		modelString = resolveDefaultModel(config);
		const parsed = parseModelString(modelString);
		provider = parsed.provider;
		modelId = parsed.modelId;
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "model_resolution",
			errorSrc: "telegram:model",
			message: e.message,
			stack: e.stack,
		});
		console.error(e.message);
		process.exitCode = 1;
		return;
	}

	if (provider !== "ollama") {
		console.error(
			`Provider '${provider}' is not supported yet. Only 'ollama' works in this build.`,
		);
		process.exitCode = 1;
		return;
	}

	// Step 4: Read bot token
	let secrets: TelegramSecrets;
	try {
		secrets = readTelegramSecrets();
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "telegram_secrets",
			errorSrc: "telegram:secrets",
			message: e.message,
			stack: e.stack,
		});
		console.error(e.message);
		process.exitCode = 1;
		return;
	}

	// Step 5: Build the allowlist
	const allowedPeers = config.channels.telegram.allowed_peers ?? [];
	if (allowedPeers.length === 0) {
		console.error(
			"Telegram allowed_peers list is empty - bot will reject ALL messages.\n" +
				"Add your Telegram user ID to config.channels.telegram.allowed_peers.",
		);
		process.exitCode = 1;
		return;
	}

	// Step 6: Create the Pi agent runtime factory (shared across peers)
	const ollamaHost = getOllamaHost();
	const authStorage = AuthStorage.create();
	const cwd = process.cwd();
	const agentDir = PI_DIRS.root;

	// Track active agent sessions per peer
	const peerAgents = new Map<string, PeerAgent>();
	const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min inactivity
	const rateLimiter = new PeerRateLimiter();

	/**
	 * Get or create a Pi agent session for a given peer.
	 */
	async function getOrCreateSession(peerId: string): Promise<AgentSession> {
		const existing = peerAgents.get(peerId);
		if (existing) {
			existing.lastActivity = Date.now();
			return existing.session;
		}

		const sessionManager = SessionManager.create(cwd);

		const createRuntime: Parameters<typeof createAgentSessionRuntime>[0] = async ({
			cwd: runtimeCwd,
			agentDir: runtimeAgentDir,
			sessionManager: runtimeSessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({
				cwd: runtimeCwd,
				agentDir: runtimeAgentDir,
				authStorage,
			});

			await withCapture(
				{
					errorSrc: "telegram:register-ollama",
					errorType: "provider_registration",
					severity: "critical",
					context: { host: ollamaHost, modelId },
				},
				async () => {
					registerOllamaProvider(services.modelRegistry, ollamaHost, modelId);
				},
			);

			const model = services.modelRegistry.find(provider, modelId);
			if (!model) {
				throw new Error(`Model ${provider}/${modelId} not found in registry after registration.`);
			}

			// Include save_persona tool when persona isn't set yet
			const needsPersona = !config.agent_persona || isPersonaTemplate();
			const tools = needsPersona ? [...codingTools, savePersonaTool] : codingTools;

			const created = await createAgentSessionFromServices({
				services,
				sessionManager: runtimeSessionManager,
				sessionStartEvent,
				model,
				tools,
			});

			const extensionErrors = services.resourceLoader
				.getExtensions()
				.errors.map(({ path: extPath, error }) => ({
					type: "error" as const,
					message: `Failed to load extension "${extPath}": ${error}`,
				}));
			const diagnostics = [...services.diagnostics, ...extensionErrors];

			return { ...created, services, diagnostics };
		};

		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd,
			agentDir,
			sessionManager,
		});

		const session = runtime.session;

		// Install filesystem security guardrails (critical for unattended Telegram channel)
		session.agent.beforeToolCall = createToolGuard(cwd);

		peerAgents.set(peerId, {
			session,
			lastActivity: Date.now(),
		});

		return session;
	}

	/**
	 * Extract text content from agent messages after a prompt completes.
	 * Scans backwards through all assistant messages to find any text response,
	 * including cases where the agent used tools before/after responding.
	 */
	function extractResponseText(session: AgentSession): string {
		const messages = session.agent.state.messages;
		const textParts: string[] = [];

		// Walk backwards, collect text from assistant messages until we hit a user message
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (!msg || !("role" in msg)) continue;

			// Stop at the user's message (we only want the agent's response)
			if (msg.role === "user") break;

			if (msg.role === "assistant" && "content" in msg) {
				const parts = (msg.content as Array<{ type: string; text?: string }>)
					.filter((c) => c.type === "text" && c.text)
					.map((c) => c.text as string);
				if (parts.length > 0) {
					textParts.unshift(...parts);
				}
			}
		}

		return textParts.length > 0 ? textParts.join("\n") : "(no response)";
	}

	// Step 7: Create grammy bot
	const bot = new Bot(secrets.bot_token);

	// Handle text messages
	bot.on("message:text", async (ctx) => {
		const peerId = String(ctx.from.id);
		const chatId = ctx.chat.id;
		const text = ctx.message.text;

		// Enforce allowlist
		if (!allowedPeers.includes(peerId)) {
			captureError({
				severity: "medium",
				errorType: "telegram_unauthorized",
				errorSrc: "telegram:allowlist",
				message: `Rejected message from unauthorized peer ${peerId}`,
				context: { peerId, chatId },
			});
			await ctx.reply("You are not authorized to use this bot.");
			return;
		}

		// Reject group messages if not allowed
		if (ctx.chat.type !== "private" && !config.channels.telegram.allow_groups) {
			return; // Silently ignore group messages
		}

		// Rate limit check
		if (!rateLimiter.check(peerId)) {
			await ctx.reply("Slow down - you're sending messages too fast. Try again in a minute.");
			return;
		}

		// Input length check
		if (text.length > MAX_INPUT_LENGTH) {
			await ctx.reply(
				`Message too long (${text.length} chars). Maximum is ${MAX_INPUT_LENGTH} characters.`,
			);
			return;
		}

		// Session cap check
		if (!peerAgents.has(peerId) && peerAgents.size >= MAX_CONCURRENT_SESSIONS) {
			await ctx.reply("Too many active sessions. Please try again later.");
			return;
		}

		console.log(`[telegram] << ${peerId}: ${text.slice(0, 80)}`);

		try {
			// Show typing indicator (refreshes every 4s while agent is thinking)
			await ctx.replyWithChatAction("typing");
			const typingInterval = setInterval(() => {
				ctx.replyWithChatAction("typing").catch(() => {});
			}, 4000);

			// Get or create session for this peer
			console.log("[telegram] Getting session...");
			const session = await getOrCreateSession(peerId);
			console.log("[telegram] Prompting agent...");

			// Send through AgentSession.prompt() which fires extension events
			await session.prompt(text);
			clearInterval(typingInterval);
			console.log("[telegram] Prompt done. Extracting...");

			// Extract the response
			const response = extractResponseText(session);
			console.log(`[telegram] >> ${response.slice(0, 120)}`);

			const sanitized = sanitizeOutput(response);
			const formatted = toTelegramMarkdown(sanitized);
			const chunks = chunkMessage(formatted);

			for (const chunk of chunks) {
				try {
					await ctx.reply(chunk, { parse_mode: "MarkdownV2" });
				} catch {
					// If markdown parsing fails, send as plain text
					await ctx.reply(chunk);
				}
			}
			console.log(`[telegram] Sent ${chunks.length} chunk(s)`);
		} catch (err) {
			const e = err instanceof Error ? err : new Error(String(err));
			captureError({
				severity: "high",
				errorType: "telegram_message_error",
				errorSrc: "telegram:handler",
				message: e.message,
				stack: e.stack,
				context: { peerId, text: text.slice(0, 100) },
			});
			console.error(`[telegram] ERROR for ${peerId}:`, e.message);
			console.error("[telegram] Stack:", e.stack?.slice(0, 300));
			try {
				await ctx.reply("Something went wrong. Check the logs.");
			} catch {
				// Can't even send error message
			}
		}
	});

	// Handle /start command
	bot.command("start", async (ctx) => {
		const peerId = String(ctx.from?.id ?? "");
		if (!allowedPeers.includes(peerId)) {
			await ctx.reply("You are not authorized to use this bot.");
			return;
		}
		await ctx.reply(
			"MyPensieve is online. Send me a message and I'll process it through your agent.",
		);
	});

	// Handle /reset command - clear the agent session for this peer
	bot.command("reset", async (ctx) => {
		const peerId = String(ctx.from?.id ?? "");
		if (!allowedPeers.includes(peerId)) return;

		const existing = peerAgents.get(peerId);
		if (existing) {
			existing.session.agent.reset();
			peerAgents.delete(peerId);
			await ctx.reply("Session reset. Next message starts a fresh conversation.");
		} else {
			await ctx.reply("No active session to reset.");
		}
	});

	// Periodic cleanup of inactive sessions
	const reapInterval = setInterval(
		() => {
			const now = Date.now();
			for (const [peerId, peer] of peerAgents) {
				if (now - peer.lastActivity > SESSION_TIMEOUT_MS) {
					peer.session.agent.reset();
					peerAgents.delete(peerId);
					console.log(`[telegram] Reaped inactive session for peer ${peerId}`);
				}
			}
		},
		5 * 60 * 1000,
	); // Check every 5 minutes

	// Graceful shutdown
	let shuttingDown = false;
	const shutdown = () => {
		if (shuttingDown) {
			// Second Ctrl+C = force exit
			console.log("\n[telegram] Force exit.");
			process.exit(0);
		}
		shuttingDown = true;
		console.log("\n[telegram] Shutting down... (Ctrl+C again to force)");
		clearInterval(reapInterval);
		bot.stop();
		rateLimiter.clear();
		for (const [, peer] of peerAgents) {
			peer.session.agent.reset();
		}
		peerAgents.clear();
		// Force exit after 2s if handles keep process alive
		setTimeout(() => process.exit(0), 2000).unref();
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// Step 8: Start long-polling
	console.log(`[telegram] Model: ${modelString} via ${ollamaHost}`);
	console.log(`[telegram] Allowed peers: ${allowedPeers.join(", ")}`);
	console.log("[telegram] Bot starting long-polling... Ctrl+C to stop.");

	bot.start({
		onStart: (botInfo) => {
			console.log(`[telegram] Bot online as @${botInfo.username}`);
		},
	});
}
