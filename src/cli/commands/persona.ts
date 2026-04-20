import {
	DEFAULT_LOADOUT_NAME,
	createLoadout,
	deleteLoadout,
	ensureLoadoutsInitialized,
	isValidLoadoutName,
	listLoadouts,
	readLoadout,
	switchLoadout,
} from "../../core/persona-loadouts.js";
import { registerCommand } from "../router.js";

function printUsage(): void {
	console.log("mypensieve persona <subcommand>");
	console.log("");
	console.log("Subcommands:");
	console.log("  list                    List all persona loadouts");
	console.log("  show [<name>]           Show a loadout's identity prompt");
	console.log("  switch <name>           Activate a loadout");
	console.log("  create <name>           Create a new loadout (interactive)");
	console.log("  delete <name>           Delete a loadout (cannot delete active)");
}

registerCommand({
	name: "persona",
	description: "Manage agent persona loadouts (list/switch/create/show/delete)",
	usage: "mypensieve persona <list|show|switch|create|delete> [args]",
	run: async (args) => {
		const sub = args[0];
		if (!sub) {
			printUsage();
			return;
		}
		ensureLoadoutsInitialized();

		switch (sub) {
			case "list":
				return runList();
			case "show":
				return runShow(args[1]);
			case "switch":
				return runSwitch(args[1]);
			case "create":
				return runCreate(args[1]);
			case "delete":
				return runDelete(args[1]);
			default:
				console.error(`Unknown persona subcommand: ${sub}`);
				printUsage();
				process.exitCode = 1;
		}
	},
});

function runList(): void {
	const loadouts = listLoadouts();
	if (loadouts.length === 0) {
		console.log("No persona loadouts yet.");
		console.log("Run 'mypensieve persona create <name>' to make one.");
		return;
	}
	const nameWidth = Math.max(...loadouts.map((l) => l.name.length));
	console.log(`${"NAME".padEnd(nameWidth + 2)}ACTIVE  DESCRIPTION`);
	for (const l of loadouts) {
		const star = l.active ? " *    " : "      ";
		const desc = l.meta.description?.slice(0, 60) ?? "";
		console.log(`${l.name.padEnd(nameWidth + 2)}${star}${desc}`);
	}
}

function runShow(name: string | undefined): void {
	const target = name ?? DEFAULT_LOADOUT_NAME;
	try {
		const meta = readLoadout(target);
		console.log(`# Loadout: ${meta.name}`);
		console.log(`Created: ${meta.created_at}`);
		if (meta.description) console.log(`Description: ${meta.description}`);
		if (meta.personality) console.log(`Personality: ${meta.personality}`);
		console.log("\n## Identity\n");
		console.log(meta.identity_prompt);
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		console.error(e.message);
		process.exitCode = 1;
	}
}

function runSwitch(name: string | undefined): void {
	if (!name) {
		console.error("Usage: mypensieve persona switch <name>");
		process.exitCode = 1;
		return;
	}
	try {
		const meta = switchLoadout(name);
		console.log(`Switched to loadout '${meta.name}'. Next session will load this persona.`);
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		console.error(e.message);
		process.exitCode = 1;
	}
}

async function runCreate(name: string | undefined): Promise<void> {
	if (!name) {
		console.error("Usage: mypensieve persona create <name>");
		process.exitCode = 1;
		return;
	}
	if (!isValidLoadoutName(name)) {
		console.error(
			`Invalid name '${name}'. Use alphanumerics, dash, underscore only (max 64 chars).`,
		);
		process.exitCode = 1;
		return;
	}
	if (!process.stdin.isTTY) {
		console.error("persona create requires an interactive TTY.");
		process.exitCode = 1;
		return;
	}
	const { intro, text, outro, isCancel } = await import("@clack/prompts");
	intro(`Creating loadout '${name}'`);
	const identity = await text({
		message: "Identity prompt (first-person instructions for the agent):",
		placeholder: "You are a thoughtful, concise assistant who...",
		validate: (v) => (v && v.length > 0 ? undefined : "Identity prompt cannot be empty."),
	});
	if (isCancel(identity)) {
		outro("Cancelled.");
		return;
	}
	const personality = await text({
		message: "Personality key for greetings (casual/formal/snarky/witty - optional):",
		placeholder: "casual",
	});
	if (isCancel(personality)) {
		outro("Cancelled.");
		return;
	}
	const description = await text({
		message: "Short description (optional):",
		placeholder: "Work persona for deep coding sessions",
	});
	if (isCancel(description)) {
		outro("Cancelled.");
		return;
	}
	try {
		const meta = createLoadout({
			name,
			identity_prompt: String(identity),
			personality: personality ? String(personality) : undefined,
			description: description ? String(description) : undefined,
			created_at: new Date().toISOString(),
		});
		outro(
			`Loadout '${meta.name}' created. Run 'mypensieve persona switch ${meta.name}' to activate.`,
		);
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		outro(`Failed: ${e.message}`);
		process.exitCode = 1;
	}
}

function runDelete(name: string | undefined): void {
	if (!name) {
		console.error("Usage: mypensieve persona delete <name>");
		process.exitCode = 1;
		return;
	}
	try {
		deleteLoadout(name);
		console.log(`Loadout '${name}' deleted.`);
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		console.error(e.message);
		process.exitCode = 1;
	}
}
