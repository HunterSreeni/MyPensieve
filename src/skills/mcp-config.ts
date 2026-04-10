/**
 * MCP server configurations for the 6 MVP MCPs.
 * These are used by the install wizard to write MCP config.
 */

export interface McpServerConfig {
	name: string;
	description: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	verbs: string[]; // which verbs this MCP backs
	authRequired: boolean;
	installNote?: string;
}

export const MCP_CONFIGS: McpServerConfig[] = [
	{
		name: "datetime",
		description: "Date/time server with configurable timezone",
		command: "python3",
		args: ["-m", "datetime_server"],
		verbs: ["*"], // utility, available to all verbs
		authRequired: false,
		installNote: "Bundled with MyPensieve. Reads timezone from config.",
	},
	{
		name: "playwright",
		description: "Browser automation (headed by default)",
		command: "npx",
		args: ["@anthropic/mcp-playwright", "--headed"],
		verbs: ["ingest", "dispatch"],
		authRequired: false,
		installNote: "Requires Node.js. Headed mode by default for operator visibility.",
	},
	{
		name: "duckduckgo-search",
		description: "Web search via DuckDuckGo (zero auth)",
		command: "uvx",
		args: ["duckduckgo-mcp-server"],
		verbs: ["research"],
		authRequired: false,
		installNote: "Python MCP. Requires uv/uvx. Zero API key needed.",
	},
	{
		name: "whisper-local",
		description: "Local speech-to-text via whisper.cpp",
		command: "npx",
		args: ["whisper-mcp"],
		verbs: ["ingest"],
		authRequired: false,
		installNote: "Requires whisper.cpp binary. Default model: base.en (142MB).",
	},
	{
		name: "gh-cli",
		description: "GitHub CLI wrapper (uses operator's gh auth)",
		command: "npx",
		args: ["gh-mcp-server"],
		verbs: ["dispatch", "monitor"],
		authRequired: false, // uses operator's existing `gh auth`
		installNote: "Wraps the operator's existing `gh` CLI auth. Run `gh auth login` first.",
	},
	{
		name: "cve-intel",
		description: "CVE intelligence from OSV.dev + NVD + EPSS + CISA KEV",
		command: "node",
		args: ["mcps/cve-intel/index.js"],
		verbs: ["monitor", "research"],
		authRequired: false,
		installNote: "Custom ~300 LOC MCP. All 4 APIs are zero-auth.",
	},
];

/**
 * Generate MCP server config JSON for Pi's mcp-servers.json format.
 */
export function generateMcpServersConfig(): Record<
	string,
	{ command: string; args: string[]; env?: Record<string, string> }
> {
	const config: Record<string, { command: string; args: string[]; env?: Record<string, string> }> =
		{};

	for (const mcp of MCP_CONFIGS) {
		config[mcp.name] = {
			command: mcp.command,
			args: mcp.args,
			...(mcp.env ? { env: mcp.env } : {}),
		};
	}

	return config;
}
