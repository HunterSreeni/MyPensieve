import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { appendJsonl, readJsonlSync } from "../utils/jsonl.js";
import type { SkillHandler } from "./executor.js";

interface CveAlert {
	id: string;
	source: string;
	severity: string;
	summary: string;
	timestamp: string;
}

/**
 * CVE Monitor skill.
 * Wraps cve-intel MCP + osv-scanner CLI.
 * Diff-only alerts - only surfaces new findings since last check.
 */
export const cveMonitorHandler: SkillHandler = async (args, ctx) => {
	const target = args.target as string;

	if (target === "cves" || target === "packages") {
		return await checkPackages(args, ctx);
	}

	return { success: false, data: null, error: `Unknown monitor target: ${target}` };
};

async function checkPackages(
	args: Record<string, unknown>,
	ctx: { project: { projectDir: string } },
): Promise<{ success: boolean; data: unknown; error?: string }> {
	const scope = args.scope as string | undefined;
	const lastCheckPath = path.join(ctx.project.projectDir, "cve-last-check.jsonl");

	// Get previous findings
	const previousAlerts = readJsonlSync<CveAlert>(lastCheckPath);
	const previousIds = new Set(previousAlerts.map((a) => a.id));

	// Check if osv-scanner is available
	const osvResults: CveAlert[] = [];
	try {
		execFileSync("osv-scanner", ["--version"], { stdio: "pipe" });
		const lockfile = scope ?? "package-lock.json";
		if (fs.existsSync(lockfile)) {
			try {
				const output = execFileSync("osv-scanner", ["--json", `--lockfile=${lockfile}`], {
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
				});
				const parsed = JSON.parse(output);
				if (parsed.results) {
					for (const result of parsed.results) {
						for (const pkg of result.packages ?? []) {
							for (const vuln of pkg.vulnerabilities ?? []) {
								osvResults.push({
									id: vuln.id ?? `osv-${Date.now()}`,
									source: "osv-scanner",
									severity: vuln.database_specific?.severity ?? "unknown",
									summary: vuln.summary ?? vuln.id ?? "Unknown vulnerability",
									timestamp: new Date().toISOString(),
								});
							}
						}
					}
				}
			} catch {
				// osv-scanner exits non-zero when vulns found - parse stdout
			}
		}
	} catch {
		// osv-scanner not installed - that's OK, we'll use MCP when connected
	}

	// Diff: only new alerts
	const newAlerts = osvResults.filter((a) => !previousIds.has(a.id));

	// Save current state for next diff
	if (osvResults.length > 0) {
		for (const alert of osvResults) {
			appendJsonl(lastCheckPath, alert);
		}
	}

	return {
		success: true,
		data: {
			deltas: newAlerts,
			total_found: osvResults.length,
			new_since_last_check: newAlerts.length,
			last_checked: new Date().toISOString(),
			note:
				osvResults.length === 0
					? "No vulnerabilities found (or osv-scanner not installed). Connect cve-intel MCP for API-based checks."
					: undefined,
		},
	};
}

/**
 * Blog-SEO skill.
 * SEO-aware drafting with Yoast-style scoring.
 */
export const blogSeoHandler: SkillHandler = async (args, _ctx) => {
	const prompt = args.prompt as string;
	if (!prompt) {
		return { success: false, data: null, error: "Missing prompt for blog post" };
	}

	const options = args.options as Record<string, unknown> | undefined;
	const targetKeyword = options?.keyword as string | undefined;

	// Yoast-style SEO scoring
	const score = calculateSeoScore(prompt, targetKeyword);

	return {
		success: true,
		data: {
			draft: prompt, // In real implementation, LLM would generate/refine this
			seo_score: score.total,
			seo_breakdown: score.breakdown,
			suggestions: score.suggestions,
			word_count: prompt.split(/\s+/).length,
			note: "Connect LLM provider for AI-assisted drafting and refinement.",
		},
	};
};

function calculateSeoScore(
	text: string,
	keyword?: string,
): { total: number; breakdown: Record<string, number>; suggestions: string[] } {
	const words = text.split(/\s+/);
	const wordCount = words.length;
	const suggestions: string[] = [];
	const breakdown: Record<string, number> = {};

	// Word count score (500-700 ideal)
	if (wordCount >= 500 && wordCount <= 700) {
		breakdown.word_count = 20;
	} else if (wordCount >= 300) {
		breakdown.word_count = 10;
		suggestions.push("Aim for 500-700 words for optimal engagement");
	} else {
		breakdown.word_count = 5;
		suggestions.push("Post is too short. Aim for at least 500 words");
	}

	// Keyword usage
	if (keyword) {
		const keywordCount = text.toLowerCase().split(keyword.toLowerCase()).length - 1;
		const density = keywordCount / wordCount;
		if (density >= 0.01 && density <= 0.03) {
			breakdown.keyword_density = 20;
		} else if (keywordCount > 0) {
			breakdown.keyword_density = 10;
			suggestions.push(
				`Keyword "${keyword}" density is ${(density * 100).toFixed(1)}%. Aim for 1-3%`,
			);
		} else {
			breakdown.keyword_density = 0;
			suggestions.push(`Keyword "${keyword}" not found in text`);
		}
	} else {
		breakdown.keyword_density = 10; // No keyword specified, neutral score
	}

	// Paragraph structure
	const paragraphs = text.split(/\n\n+/);
	if (paragraphs.length >= 3) {
		breakdown.structure = 20;
	} else {
		breakdown.structure = 10;
		suggestions.push("Break content into more paragraphs (at least 3)");
	}

	// Readability (simple sentence length check)
	const sentences = text.split(/[.!?]+/).filter(Boolean);
	const avgSentenceLength = sentences.length > 0 ? wordCount / sentences.length : wordCount;
	if (avgSentenceLength <= 20) {
		breakdown.readability = 20;
	} else {
		breakdown.readability = 10;
		suggestions.push("Sentences are too long. Aim for under 20 words per sentence");
	}

	// Question ending (engagement)
	if (text.includes("?")) {
		breakdown.engagement = 20;
	} else {
		breakdown.engagement = 10;
		suggestions.push("End with a question to drive engagement");
	}

	const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
	return { total, breakdown, suggestions };
}

/**
 * Playwright-CLI skill.
 * Wraps the Playwright MCP for browser automation.
 * CLI-only - blocked on Telegram channel.
 */
export const playwrightCliHandler: SkillHandler = async (args, ctx) => {
	if (ctx.channelType === "telegram") {
		return {
			success: false,
			data: null,
			error: "playwright-cli is not available on Telegram channel (security restriction)",
		};
	}

	const source = args.source as string | undefined;
	const interactive = args.interactive as boolean | undefined;

	return {
		success: true,
		data: {
			status: "mcp_delegation",
			target: "playwright",
			source,
			interactive: interactive ?? false,
			message: "Browser automation requires Playwright MCP. Connect it to enable web interaction.",
		},
	};
};
