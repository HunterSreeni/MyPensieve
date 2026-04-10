import { ConfigReadError, readConfig } from "../../config/index.js";
import { PI_DIRS } from "../../config/paths.js";
import { getProjectBinding } from "../../core/session.js";
import { validateChannelBinding } from "../../gateway/binding-validator.js";
import { GatewayDispatcher, type SkillExecutor } from "../../gateway/dispatcher.js";
import { loadAllRoutingTables } from "../../gateway/routing-loader.js";
import {
	applySkillRegistrations,
	scanSkillsForRegistration,
} from "../../gateway/skill-registration.js";
import { loadProject } from "../../projects/loader.js";
import { registerShutdownHandlers } from "./shutdown.js";

/**
 * Start an interactive CLI session.
 *
 * This is the main entry point for `mypensieve start`.
 * It:
 * 1. Loads and validates config
 * 2. Creates the project binding from cwd
 * 3. Loads the project state (memory layers, SQLite index)
 * 4. Sets up the gateway with routing tables + skill registrations
 * 5. Registers shutdown handlers
 * 6. Hands off to Pi's interactive session (Phase 1 integration)
 *
 * Note: Full Pi interactive mode integration requires Phase 1's
 * createMyPensieveSession. For now, this sets up everything except
 * the actual Pi TUI loop.
 */
export async function startCliSession(opts?: { configPath?: string }): Promise<void> {
	// Step 1: Load config
	let config;
	try {
		config = readConfig(opts?.configPath);
	} catch (err) {
		if (err instanceof ConfigReadError) {
			console.error(err.message);
			console.error("Run 'mypensieve init' to set up your configuration.");
			process.exitCode = 1;
			return;
		}
		throw err;
	}

	// Step 2: Validate channel
	try {
		validateChannelBinding("cli", config.channels);
	} catch (err) {
		console.error("Channel validation failed:", err instanceof Error ? err.message : String(err));
		process.exitCode = 1;
		return;
	}

	// Step 3: Project binding
	const cwd = process.cwd();
	const binding = getProjectBinding("cli", cwd);
	console.log(`[mypensieve] Project: ${binding}`);

	// Step 4: Load project state
	const project = loadProject(binding);
	console.log(
		`[mypensieve] Memory index loaded (${project.index.getStats().decisions} decisions, ${project.index.getStats().threads} threads)`,
	);

	// Step 5: Load gateway
	const routingTables = loadAllRoutingTables();
	const skillRegistrations = scanSkillsForRegistration(PI_DIRS.skills);
	applySkillRegistrations(routingTables, skillRegistrations);

	// Create executor that routes to memory for recall, stubs for others
	const executor: SkillExecutor = async (target, _type, args) => {
		if (target === "memory-recall") {
			return project.memoryQuery.recall({
				query: args.query as string,
				project: args.project as string | undefined,
				layers: args.layers as
					| Array<"decisions" | "threads" | "persona" | "semantic" | "raw">
					| undefined,
				limit: args.limit as number | undefined,
			});
		}
		// Other skills will be implemented in Phase 5
		return { status: "not_implemented", target, args };
	};

	// Dispatcher is ready for when Pi interactive mode is wired in
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	void new GatewayDispatcher(routingTables, executor);

	// Step 6: Register shutdown handlers
	registerShutdownHandlers(project, async () => {
		// Phase 3: Run session-end extractor here
		console.log("[mypensieve] Running session-end extraction...");
		// Extractor implementation comes in Phase 5
	});

	console.log("[mypensieve] Session ready. Gateway active with 8 verbs.");
	console.log("[mypensieve] Pi interactive mode integration pending (requires Pi session).");
	console.log("[mypensieve] Press Ctrl+C to exit.");

	// In full implementation, this is where we'd call:
	//   const { session } = await createMyPensieveSession({ channelType: "cli", cwd });
	//   await InteractiveMode.run(session, ...);
	//
	// For now, keep the process alive until interrupted
	await new Promise<void>((resolve) => {
		process.on("SIGINT", () => resolve());
		process.on("SIGTERM", () => resolve());
	});
}
