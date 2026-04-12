#!/usr/bin/env node

import "./commands/index.js";
import { captureError, installProcessErrorHandlers } from "../ops/index.js";
import { dispatch } from "./router.js";

async function main(): Promise<void> {
	installProcessErrorHandlers();
	try {
		await dispatch(process.argv.slice(2));
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "cli_dispatch",
			errorSrc: "cli:main",
			message: e.message,
			stack: e.stack,
			context: { argv: process.argv.slice(2) },
		});
		console.error("Fatal error:", e.message);
		process.exitCode = 1;
	}
}

main();
