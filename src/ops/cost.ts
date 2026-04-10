import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../config/paths.js";

export interface CostEntry {
	timestamp: string;
	provider: string;
	model: string;
	tier: string;
	input_tokens: number;
	output_tokens: number;
	estimated_cost_usd: number;
	verb?: string;
	tool_call_id?: string;
}

export interface DailyCostSummary {
	date: string;
	total_cost_usd: number;
	by_provider: Record<string, number>;
	by_tier: Record<string, number>;
	total_input_tokens: number;
	total_output_tokens: number;
}

/**
 * Log a cost entry for a tool call.
 */
export function logCost(entry: CostEntry): void {
	const date = entry.timestamp.slice(0, 10);
	const costPath = path.join(DIRS.logsCost, `${date}.json`);

	let summary: DailyCostSummary;
	if (fs.existsSync(costPath)) {
		summary = JSON.parse(fs.readFileSync(costPath, "utf-8")) as DailyCostSummary;
	} else {
		summary = {
			date,
			total_cost_usd: 0,
			by_provider: {},
			by_tier: {},
			total_input_tokens: 0,
			total_output_tokens: 0,
		};
	}

	summary.total_cost_usd += entry.estimated_cost_usd;
	summary.total_input_tokens += entry.input_tokens;
	summary.total_output_tokens += entry.output_tokens;
	summary.by_provider[entry.provider] =
		(summary.by_provider[entry.provider] ?? 0) + entry.estimated_cost_usd;
	summary.by_tier[entry.tier] = (summary.by_tier[entry.tier] ?? 0) + entry.estimated_cost_usd;

	fs.mkdirSync(path.dirname(costPath), { recursive: true });
	fs.writeFileSync(costPath, JSON.stringify(summary, null, 2), "utf-8");
}

/**
 * Read today's cost summary.
 */
export function readDailyCost(date?: string): DailyCostSummary | null {
	const d = date ?? new Date().toISOString().slice(0, 10);
	const costPath = path.join(DIRS.logsCost, `${d}.json`);

	if (!fs.existsSync(costPath)) return null;
	return JSON.parse(fs.readFileSync(costPath, "utf-8")) as DailyCostSummary;
}
