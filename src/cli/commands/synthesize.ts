import { formatSynthesisReport, runSynthesis } from "../../memory/synthesizer-runner.js";
import { registerCommand } from "../router.js";

registerCommand({
	name: "synthesize",
	description: "Run memory synthesizer (de-dup decisions, aggregate persona deltas)",
	usage: "mypensieve synthesize [--apply] [--project <binding>]",
	run: async (args) => {
		const apply = args.includes("--apply");
		let project: string | undefined;
		const pIdx = args.indexOf("--project");
		if (pIdx >= 0) {
			const next = args[pIdx + 1];
			if (!next || next.startsWith("--")) {
				console.error("Usage: mypensieve synthesize --project <binding>");
				process.exitCode = 1;
				return;
			}
			project = next;
		}
		const result = runSynthesis({ apply, project });
		console.log(formatSynthesisReport(result));
		if (!apply && result.total_duplicates_removed > 0) {
			console.log("\nRun with --apply to rewrite decisions.jsonl and mark deltas applied.");
		}
	},
});
