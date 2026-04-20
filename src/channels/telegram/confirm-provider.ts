import crypto from "node:crypto";
/**
 * Telegram inline-button confirm provider for the dispatcher.
 *
 * When an agent calls a confirmation-required verb (e.g. `dispatch`), the
 * dispatcher invokes this provider. We send a Telegram message with two
 * inline buttons and await the operator's tap. Timeouts auto-deny.
 */
import { InlineKeyboard } from "grammy";
import type { Api, Bot } from "grammy";
import type { ConfirmProvider, ConfirmResponse } from "../../gateway/dispatcher.js";

/** Telegram message API surface we need - narrow subset of grammy's Bot. */
export interface TelegramSender {
	sendMessage: Api["sendMessage"];
}

export interface TelegramConfirmRegistry {
	/** Peer this registry is scoped to; callbacks from other peers are ignored. */
	readonly peerId: string;
	/** Resolve a pending confirmation. Returns true if the id was pending. */
	resolve(requestId: string, approved: boolean, reason?: string): boolean;
}

export interface TelegramConfirmProviderOptions {
	/** Bot sender (or any object with a sendMessage compatible signature). */
	bot: TelegramSender;
	/** Peer to receive the confirmation prompt. */
	peerId: string;
	/** Auto-deny after this many milliseconds. Default 60s. */
	timeoutMs?: number;
}

interface Pending {
	resolve: (r: ConfirmResponse) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Create a confirm provider and a companion registry. The provider is passed
 * to the dispatcher; the registry is used by a grammy `callback_query` handler
 * to resolve pending prompts when the operator taps Approve/Deny.
 */
export function createTelegramConfirmProvider(opts: TelegramConfirmProviderOptions): {
	provider: ConfirmProvider;
	registry: TelegramConfirmRegistry;
} {
	const pending = new Map<string, Pending>();
	const timeoutMs = opts.timeoutMs ?? 60_000;

	const provider: ConfirmProvider = async (req) => {
		const requestId = crypto.randomUUID();
		const preview = `Agent wants to run ${req.verb}(${String(req.args.action ?? "<unspecified>")}).\nApprove?`;
		const keyboard = new InlineKeyboard()
			.text("Approve", `confirm:${requestId}:yes`)
			.text("Deny", `confirm:${requestId}:no`);

		try {
			await opts.bot.sendMessage(opts.peerId, preview, { reply_markup: keyboard });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { approved: false, reason: `failed to send confirm prompt: ${msg}` };
		}

		return new Promise<ConfirmResponse>((resolve) => {
			const timer = setTimeout(() => {
				pending.delete(requestId);
				resolve({ approved: false, reason: "timeout" });
			}, timeoutMs);
			pending.set(requestId, { resolve, timer });
		});
	};

	const registry: TelegramConfirmRegistry = {
		peerId: opts.peerId,
		resolve(requestId, approved, reason) {
			const entry = pending.get(requestId);
			if (!entry) return false;
			clearTimeout(entry.timer);
			pending.delete(requestId);
			entry.resolve({ approved, reason });
			return true;
		},
	};

	return { provider, registry };
}

/**
 * Register a grammy `callback_query` handler that looks up the pending
 * confirmation by request-id embedded in the button payload. Payloads have
 * shape `confirm:<requestId>:<yes|no>`.
 *
 * The registry argument must be the same object returned by the matching
 * `createTelegramConfirmProvider` call; typically one per peer.
 */
export function attachConfirmCallbackHandler(
	bot: Bot,
	getRegistryForPeer: (peerId: string) => TelegramConfirmRegistry | undefined,
): void {
	bot.callbackQuery(/^confirm:([^:]+):(yes|no)$/, async (ctx) => {
		const tapperId = String(ctx.from?.id ?? "");
		const reg = getRegistryForPeer(tapperId);
		const match = ctx.match;
		const requestId = match?.[1];
		const decision = match?.[2];
		if (!reg || !requestId || !decision) {
			await ctx.answerCallbackQuery({ text: "Expired or invalid request" });
			return;
		}
		// Defense-in-depth: reject taps from a peer that doesn't own this
		// registry. This matters in group chats where multiple allowed peers
		// share a message thread - without this check, peer A could approve
		// peer B's destructive dispatch.
		if (reg.peerId !== tapperId) {
			await ctx.answerCallbackQuery({ text: "Not authorized to approve this prompt" });
			return;
		}
		const approved = decision === "yes";
		const handled = reg.resolve(requestId, approved, approved ? undefined : "operator denied");
		if (handled) {
			await ctx.answerCallbackQuery({ text: approved ? "Approved" : "Denied" });
		} else {
			await ctx.answerCallbackQuery({ text: "Request already resolved or expired" });
		}
	});
}
