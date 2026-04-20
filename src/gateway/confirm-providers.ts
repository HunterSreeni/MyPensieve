import type { ConfirmProvider } from "./dispatcher.js";

/**
 * Confirm providers for the gateway. Channels install one of these so the
 * dispatcher can request operator approval before executing destructive verbs.
 */

/**
 * Auto-policy provider for unattended contexts (daemon, scheduled echoes).
 * - "deny": reject all confirmation requests (safest).
 * - "allow": approve all confirmation requests (trusted automation only).
 */
export function createAutoPolicyConfirmProvider(policy: "deny" | "allow"): ConfirmProvider {
	return async (req) => {
		if (policy === "allow") {
			return { approved: true, reason: "auto-allow policy" };
		}
		return {
			approved: false,
			reason: `daemon auto-deny policy blocked ${req.verb}(${String(req.args.action ?? "")})`,
		};
	};
}

/**
 * CLI confirm provider. Prompts the operator interactively via stdin using
 * the same @clack/prompts library the init wizard uses. When stdin is not a
 * TTY (piped, redirected), returns a deny to avoid hanging.
 */
export function createCliConfirmProvider(): ConfirmProvider {
	return async (req) => {
		if (!process.stdin.isTTY) {
			return { approved: false, reason: "no TTY - cannot prompt for confirmation" };
		}
		const { confirm, isCancel } = await import("@clack/prompts");
		const preview = `Agent wants to run ${req.verb}: ${String(req.args.action ?? "<unspecified action>")}`;
		const decision = await confirm({
			message: `${preview}\nApprove?`,
			initialValue: false,
		});
		if (isCancel(decision) || !decision) {
			return { approved: false, reason: "operator declined" };
		}
		return { approved: true };
	};
}
