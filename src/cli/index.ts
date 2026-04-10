#!/usr/bin/env node

import "./commands/index.js";
import { dispatch } from "./router.js";

async function main(): Promise<void> {
	try {
		await dispatch(process.argv.slice(2));
	} catch (err) {
		console.error("Fatal error:", err instanceof Error ? err.message : String(err));
		process.exitCode = 1;
	}
}

main();
