import { captureError } from "../ops/index.js";
import { VERSION } from "../version.js";

export interface CommandHandler {
	name: string;
	description: string;
	usage: string;
	run: (args: string[]) => Promise<void>;
}

const commands = new Map<string, CommandHandler>();

export function registerCommand(handler: CommandHandler): void {
	commands.set(handler.name, handler);
}

export function getCommand(name: string): CommandHandler | undefined {
	return commands.get(name);
}

export function getAllCommands(): CommandHandler[] {
	return Array.from(commands.values());
}

/**
 * Parse argv and dispatch to the correct command handler.
 * argv is process.argv.slice(2) - i.e. just the command and its args.
 */
export async function dispatch(argv: string[]): Promise<void> {
	const commandName = argv[0];

	if (!commandName || commandName === "--help" || commandName === "-h") {
		printHelp();
		return;
	}

	if (commandName === "--version" || commandName === "-v") {
		console.log(`mypensieve v${VERSION}`);
		return;
	}

	const handler = getCommand(commandName);
	if (!handler) {
		captureError({
			severity: "low",
			errorType: "cli_unknown_command",
			errorSrc: "cli:router",
			message: `Unknown command: ${commandName}`,
			context: { argv },
		});
		console.error(`Unknown command: ${commandName}`);
		console.error(`Run 'mypensieve --help' for a list of commands.`);
		process.exitCode = 1;
		return;
	}

	try {
		await handler.run(argv.slice(1));
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "cli_command_failed",
			errorSrc: `cli:command:${commandName}`,
			message: e.message,
			stack: e.stack,
			context: { command: commandName, args: argv.slice(1) },
		});
		throw err;
	}
}

function printHelp(): void {
	console.log("mypensieve - A self-evolving autonomous agent OS with persistent memory\n");
	console.log("Usage: mypensieve <command> [options]\n");
	console.log("Commands:");

	const cmds = getAllCommands();
	const maxLen = Math.max(...cmds.map((c) => c.name.length));

	for (const cmd of cmds) {
		console.log(`  ${cmd.name.padEnd(maxLen + 2)}${cmd.description}`);
	}

	console.log("\nRun 'mypensieve <command> --help' for command-specific help.");
}
