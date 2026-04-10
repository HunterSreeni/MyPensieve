import type { SkillHandler } from "./executor.js";

/**
 * Researcher skill.
 * Plan-search-read-synthesize loop.
 *
 * In full implementation, this uses:
 * - duckduckgo-search MCP for web search
 * - @mozilla/readability + jsdom for content extraction
 * - pi-ai.complete(tier_hint: cheap) for query planning and synthesis
 *
 * MVP implementation provides the framework + mock search.
 * Real search integration comes when the DuckDuckGo MCP is connected.
 */
export const researcherHandler: SkillHandler = async (args, _ctx) => {
	const topic = args.topic as string;
	if (!topic) {
		return { success: false, data: null, error: "Missing required arg: topic" };
	}

	const depth = (args.depth as string) ?? "standard";
	const maxSources = (args.max_sources as number) ?? 5;

	// Step 1: Query planning
	const queryPlan = planQueries(topic, depth);

	// Step 2: Search (stubbed - will use DuckDuckGo MCP when connected)
	const searchResults = await executeSearches(queryPlan, maxSources);

	// Step 3: Synthesize
	const synthesis = synthesize(topic, searchResults);

	return {
		success: true,
		data: {
			synthesis: synthesis.text,
			citations: synthesis.citations,
			query_plan: queryPlan,
			sources_found: searchResults.length,
			depth,
		},
	};
};

function planQueries(topic: string, depth: string): string[] {
	const base = [topic];
	if (depth === "standard" || depth === "deep") {
		base.push(`${topic} best practices`);
		base.push(`${topic} common issues`);
	}
	if (depth === "deep") {
		base.push(`${topic} alternatives comparison`);
		base.push(`${topic} latest research 2026`);
	}
	return base;
}

interface SearchResult {
	url: string;
	title: string;
	snippet: string;
	accessed: string;
}

async function executeSearches(queries: string[], maxSources: number): Promise<SearchResult[]> {
	// Stub: In real implementation, each query goes to DuckDuckGo MCP
	// and results are deduplicated across queries.
	// For now, return a placeholder indicating MCP connection needed.
	return queries.slice(0, maxSources).map((q, i) => ({
		url: `https://search.example.com/result/${i}`,
		title: `Search result for: ${q}`,
		snippet: `[MCP not connected] This is a placeholder for search results about "${q}". Connect the duckduckgo-search MCP to enable real web search.`,
		accessed: new Date().toISOString(),
	}));
}

function synthesize(
	topic: string,
	results: SearchResult[],
): {
	text: string;
	citations: Array<{ index: number; url: string; title: string; accessed: string }>;
} {
	if (results.length === 0) {
		return {
			text: `No search results found for "${topic}". Connect the duckduckgo-search MCP to enable web research.`,
			citations: [],
		};
	}

	const citationList = results.map((r, i) => ({
		index: i + 1,
		url: r.url,
		title: r.title,
		accessed: r.accessed,
	}));

	const snippets = results.map((r, i) => `[${i + 1}] ${r.snippet}`).join("\n\n");
	const text = `Research on "${topic}":\n\n${snippets}\n\nNote: Connect DuckDuckGo MCP for real search results.`;

	return { text, citations: citationList };
}
