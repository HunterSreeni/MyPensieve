import { startCliSession } from "../../channels/cli/start.js";
import { registerCommand } from "../router.js";
import { runDoctor } from "./doctor.js";
import { runErrors } from "./errors.js";

// --- Functional commands (Phase 4) ---

registerCommand({
	name: "start",
	description: "Start an interactive CLI session",
	usage: "mypensieve start",
	run: async (_args) => {
		await startCliSession();
	},
});

registerCommand({
	name: "doctor",
	description: "Run a healthcheck on all components",
	usage: "mypensieve doctor",
	run: async (_args) => {
		runDoctor();
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
		const { execSync } = await import("node:child_process");
		try {
			execSync(`${editor} "${CONFIG_PATH}"`, { stdio: "inherit" });
		} catch {
			console.error(`Failed to open editor. Manually edit: ${CONFIG_PATH}`);
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
		console.log("[Phase 5] Daily-log skill not yet implemented.");
	},
});

registerCommand({
	name: "recover",
	description: "Run automated recovery actions for unresolved errors",
	usage: "mypensieve recover [--reset-extractor]",
	run: async (_args) => {
		console.log("[Phase 7] Recovery engine not yet implemented.");
	},
});

registerCommand({
	name: "backup",
	description: "Create a manual backup or verify an existing one",
	usage: "mypensieve backup [verify]",
	run: async (args) => {
		const subcommand = args[0];
		if (subcommand === "verify") {
			console.log("[Phase 7] Backup verify not yet implemented.");
			return;
		}
		console.log("[Phase 7] Backup engine not yet implemented.");
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
		console.log(`[Phase 7] Restore not yet implemented. File: ${file}`);
	},
});

registerCommand({
	name: "deliberate",
	description: "Trigger council mode for multi-agent deliberation",
	usage: 'mypensieve deliberate "<topic>" [--agents name1,name2,name3]',
	run: async (_args) => {
		console.log("[Phase 8] Council mode not yet implemented.");
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
		console.log(`[Phase 8] Agent management not yet implemented. Name: ${args[1]}`);
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
		console.log(`[Phase 5] Skill management not yet implemented. Name: ${args[1]}`);
	},
});

registerCommand({
	name: "extract",
	description: "Manually run the memory extractor on recent sessions",
	usage: "mypensieve extract [--all]",
	run: async (_args) => {
		console.log("[Phase 3] Manual extractor not yet implemented.");
	},
});
