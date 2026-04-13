import { startCliSession } from "../../channels/cli/start.js";
import { VERSION } from "../../version.js";
import { registerCommand } from "../router.js";
import { runDoctor } from "./doctor.js";
import { runErrors } from "./errors.js";

// --- Functional commands (Phase 4) ---

registerCommand({
	name: "start",
	description: "Start MyPensieve (always-on daemon: Telegram + scheduler)",
	usage: "mypensieve start",
	run: async (_args) => {
		const { readConfig } = await import("../../config/index.js");
		const { EchoScheduler } = await import("../../core/scheduler/index.js");
		let config: import("../../config/schema.js").Config;
		try {
			config = readConfig();
		} catch {
			console.error("No config found. Run 'mypensieve init' first.");
			process.exitCode = 1;
			return;
		}

		// Boot echoes (in-process scheduled tasks, cross-OS)
		const echoes = new EchoScheduler(config.operator.timezone);
		echoes.registerFromConfig(config);

		// Graceful shutdown for echoes
		const shutdownEchoes = () => echoes.stopAll();
		process.on("SIGINT", shutdownEchoes);
		process.on("SIGTERM", shutdownEchoes);

		if (!config.channels.telegram.enabled) {
			console.log("[mypensieve] Telegram not enabled - running echoes only.");
			console.log("[mypensieve] Use 'mypensieve cli' for interactive sessions.");
			console.log("[mypensieve] Press Ctrl+C to stop.\n");
			// Keep process alive for echoes
			await new Promise(() => {});
			return;
		}

		const { startTelegramListener } = await import("../../channels/telegram/start.js");
		await startTelegramListener();
	},
});

registerCommand({
	name: "cli",
	description: "Open an interactive CLI session (on-demand)",
	usage: "mypensieve cli",
	run: async (_args) => {
		await startCliSession();
	},
});

registerCommand({
	name: "doctor",
	description: "Run a healthcheck on all components",
	usage: "mypensieve doctor",
	run: async (_args) => {
		await runDoctor();
	},
});

registerCommand({
	name: "status",
	description: "Show version, model, and config summary",
	usage: "mypensieve status",
	run: async (_args) => {
		const { readConfig } = await import("../../config/index.js");
		const { resolveDefaultModel } = await import("../../config/schema.js");
		const { getOllamaHost } = await import("../../providers/ollama.js");

		console.log(`MyPensieve v${VERSION}\n`);

		try {
			const config = readConfig();
			const model = resolveDefaultModel(config);
			const host = getOllamaHost();

			console.log(`  Operator:    ${config.operator.name}`);
			console.log(`  Timezone:    ${config.operator.timezone}`);
			console.log(`  Model:       ${model}`);
			console.log(`  Ollama host: ${host}`);
			console.log(`  Channels:    CLI${config.channels.telegram.enabled ? " + Telegram" : ""}`);
			console.log(`  Persona:     ${config.agent_persona?.name ?? "(not set)"}`);
			console.log(`  Embeddings:  ${config.embeddings.enabled ? "enabled" : "disabled"}`);
			console.log(`  Backup:      ${config.backup.enabled ? "enabled" : "disabled"}`);
		} catch {
			console.log("  No config found. Run 'mypensieve init' first.");
		}
	},
});

registerCommand({
	name: "errors",
	description: "Show the error log",
	usage: "mypensieve errors [--severity critical|high|medium|low|info] [--date YYYY-MM-DD]",
	run: async (args) => {
		const severity = args.find((a) => !a.startsWith("--"))?.replace("--severity=", "");
		runErrors({ severity });
	},
});

registerCommand({
	name: "config",
	description: "Edit the config file",
	usage: "mypensieve config edit",
	run: async (args) => {
		const subcommand = args[0];
		if (subcommand !== "edit") {
			console.error("Usage: mypensieve config edit");
			process.exitCode = 1;
			return;
		}
		const { CONFIG_PATH } = await import("../../config/paths.js");
		const editor = process.env.EDITOR ?? process.env.VISUAL ?? "nano";
		console.log(`Opening ${CONFIG_PATH} in ${editor}...`);
		const { execFileSync } = await import("node:child_process");
		try {
			execFileSync(editor, [CONFIG_PATH], { stdio: "inherit" });
		} catch {
			console.error(`Failed to open editor '${editor}'. Manually edit: ${CONFIG_PATH}`);
		}
	},
});

// --- Skeleton commands (later phases) ---

registerCommand({
	name: "init",
	description: "Run the install wizard",
	usage: "mypensieve init [--restart]",
	run: async (args) => {
		const { runWizard } = await import("../../wizard/framework.js");
		const { createWizardSteps } = await import("../../wizard/steps.js");
		const restart = args.includes("--restart");
		await runWizard(createWizardSteps(), { restart });
	},
});

registerCommand({
	name: "log",
	description: "Trigger the daily-log skill manually",
	usage: "mypensieve log [--date YYYY-MM-DD]",
	run: async (_args) => {
		console.log(
			"Daily-log skill coming in v0.2.0. Use 'mypensieve start' for interactive sessions.",
		);
	},
});

registerCommand({
	name: "recover",
	description: "Run automated recovery actions for unresolved errors",
	usage: "mypensieve recover [--reset-extractor]",
	run: async (_args) => {
		console.log("Recovery engine coming in v0.2.0.");
	},
});

registerCommand({
	name: "backup",
	description: "Create a manual backup or verify an existing one",
	usage: "mypensieve backup [verify]",
	run: async (args) => {
		const subcommand = args[0];
		if (subcommand === "verify") {
			console.log("Backup verify coming in v0.2.0.");
			return;
		}
		console.log("Backup engine coming in v0.2.0.");
	},
});

registerCommand({
	name: "restore",
	description: "Restore from a backup file",
	usage: "mypensieve restore <backup-file>",
	run: async (args) => {
		const file = args[0];
		if (!file) {
			console.error("Usage: mypensieve restore <backup-file>");
			process.exitCode = 1;
			return;
		}
		console.log(`Restore coming in v0.2.0. Backup file: ${file}`);
	},
});

registerCommand({
	name: "deliberate",
	description: "Trigger council mode for multi-agent deliberation",
	usage: 'mypensieve deliberate "<topic>" [--agents name1,name2,name3]',
	run: async (_args) => {
		console.log("Council deliberation coming in v0.2.0.");
	},
});

registerCommand({
	name: "agent",
	description: "Manage agent personas",
	usage: "mypensieve agent add <name>",
	run: async (args) => {
		const subcommand = args[0];
		if (subcommand !== "add" || !args[1]) {
			console.error("Usage: mypensieve agent add <name>");
			process.exitCode = 1;
			return;
		}
		console.log(`Agent management coming in v0.2.0. Agent: ${args[1]}`);
	},
});

registerCommand({
	name: "skill",
	description: "Manage skills",
	usage: "mypensieve skill add <name>",
	run: async (args) => {
		const subcommand = args[0];
		if (subcommand !== "add" || !args[1]) {
			console.error("Usage: mypensieve skill add <name>");
			process.exitCode = 1;
			return;
		}
		console.log(`Skill management coming in v0.2.0. Skill: ${args[1]}`);
	},
});

registerCommand({
	name: "daemon",
	description: "Manage the always-on background service (systemd)",
	usage: "mypensieve daemon install|uninstall|status",
	run: async (args) => {
		const subcommand = args[0];
		if (!subcommand || !["install", "uninstall", "status"].includes(subcommand)) {
			console.error("Usage: mypensieve daemon install|uninstall|status");
			console.error("");
			console.error("  install    Create and start the systemd user service");
			console.error("  uninstall  Stop and remove the service");
			console.error("  status     Show service status and recent logs");
			process.exitCode = 1;
			return;
		}
		const { installDaemon, uninstallDaemon, daemonStatus } = await import("./daemon.js");
		switch (subcommand) {
			case "install":
				await installDaemon();
				break;
			case "uninstall":
				await uninstallDaemon();
				break;
			case "status":
				await daemonStatus();
				break;
		}
	},
});

registerCommand({
	name: "extract",
	description: "Manually run the memory extractor on recent sessions",
	usage: "mypensieve extract [--all]",
	run: async (_args) => {
		console.log("Manual extractor coming in v0.2.0.");
	},
});
