import { describe, expect, it, vi } from "vitest";
import { createTelegramConfirmProvider } from "../../src/channels/telegram/confirm-provider.js";

function fakeBot() {
	return {
		sendMessage: vi.fn(async (_peer: unknown, _text: unknown, _opts: unknown) => ({
			message_id: 1,
		})) as unknown as import("grammy").Api["sendMessage"],
	};
}

describe("createTelegramConfirmProvider", () => {
	it("resolves with approved when registry.resolve(.., true) is called", async () => {
		const bot = fakeBot();
		const { provider, registry } = createTelegramConfirmProvider({
			bot,
			peerId: "peer-1",
			timeoutMs: 10_000,
		});

		const pending = provider({
			verb: "dispatch",
			args: { action: "git.push" },
			target: "gh",
			channelType: "telegram",
			project: "telegram/peer-1",
		});

		// Wait a tick so sendMessage has been called and the pending entry is registered.
		await Promise.resolve();
		expect(bot.sendMessage).toHaveBeenCalledOnce();

		// Extract requestId from the inline keyboard button callback_data
		const sendArgs = (bot.sendMessage as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
		const replyMarkup = (
			sendArgs?.[2] as {
				reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> };
			}
		)?.reply_markup;
		const callbackData = replyMarkup?.inline_keyboard?.[0]?.[0]?.callback_data ?? "";
		const requestId = callbackData.split(":")[1];
		expect(requestId).toBeTruthy();

		const handled = registry.resolve(requestId as string, true);
		expect(handled).toBe(true);

		const result = await pending;
		expect(result.approved).toBe(true);
	});

	it("auto-denies after timeout", async () => {
		vi.useFakeTimers();
		try {
			const bot = fakeBot();
			const { provider } = createTelegramConfirmProvider({
				bot,
				peerId: "peer-2",
				timeoutMs: 100,
			});

			const promise = provider({
				verb: "dispatch",
				args: { action: "rm" },
				target: "bash",
				channelType: "telegram",
				project: "telegram/peer-2",
			});
			// Flush the microtask that registers the pending entry, then
			// advance past the timeout. advanceTimersByTimeAsync also drains
			// microtasks so the resolve is observed by the await below.
			await vi.advanceTimersByTimeAsync(200);
			const result = await promise;
			expect(result.approved).toBe(false);
			expect(result.reason).toBe("timeout");
		} finally {
			vi.useRealTimers();
		}
	});

	it("denies immediately if sendMessage throws", async () => {
		const bot = {
			sendMessage: vi.fn(async () => {
				throw new Error("network down");
			}) as unknown as import("grammy").Api["sendMessage"],
		};
		const { provider } = createTelegramConfirmProvider({ bot, peerId: "peer-3" });
		const result = await provider({
			verb: "dispatch",
			args: { action: "x" },
			target: "skill",
			channelType: "telegram",
			project: "telegram/peer-3",
		});
		expect(result.approved).toBe(false);
		expect(result.reason).toContain("network down");
	});

	it("registry.resolve returns false for unknown requestId", () => {
		const { registry } = createTelegramConfirmProvider({ bot: fakeBot(), peerId: "p" });
		expect(registry.resolve("no-such-id", true)).toBe(false);
	});
});
