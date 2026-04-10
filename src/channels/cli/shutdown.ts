import type { ProjectState } from "../../projects/loader.js";
import { closeProject } from "../../projects/loader.js";

/**
 * Register shutdown handlers for clean session teardown.
 * Ensures memory index is closed and extractor can run.
 *
 * @param project - The active project state
 * @param onShutdown - Optional callback for additional shutdown logic (e.g. extractor)
 */
export function registerShutdownHandlers(
	project: ProjectState,
	onShutdown?: () => Promise<void> | void,
): void {
	let shutdownCalled = false;

	const handler = async (signal: string) => {
		if (shutdownCalled) return;
		shutdownCalled = true;

		console.log(`\n[mypensieve] Shutting down (${signal})...`);

		try {
			if (onShutdown) {
				await onShutdown();
			}
		} catch (err) {
			console.error(
				"[mypensieve] Error during shutdown:",
				err instanceof Error ? err.message : String(err),
			);
		} finally {
			closeProject(project);
			console.log("[mypensieve] Session ended.");
		}
	};

	process.on("SIGINT", () => handler("SIGINT"));
	process.on("SIGTERM", () => handler("SIGTERM"));
	process.on("beforeExit", () => handler("exit"));
}
