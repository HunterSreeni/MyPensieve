import type { Config } from "../config/schema.js";
import { writeConfig } from "../config/writer.js";
import { scaffoldDirectories } from "../init/directories.js";
import type { WizardStep } from "./framework.js";

/**
 * All 9 wizard steps for `mypensieve init`.
 * In full implementation, each step would prompt for interactive input.
 * MVP creates a default config with sensible defaults.
 */
export function createWizardSteps(): WizardStep[] {
	return [
		{
			name: "welcome",
			description: "Welcome + operator profile",
			run: async (state) => {
				state.config.operator = {
					name: (state.config.operator_name as string) ?? process.env.USER ?? "operator",
					timezone:
						(state.config.timezone as string) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
				};
				console.log(`  Operator: ${(state.config.operator as Record<string, string>).name}`);
				console.log(`  Timezone: ${(state.config.operator as Record<string, string>).timezone}`);
			},
		},
		{
			name: "project",
			description: "Create default project",
			run: async (state) => {
				state.config.default_project = process.cwd();
				console.log(`  Default project directory: ${state.config.default_project}`);
			},
		},
		{
			name: "providers",
			description: "AI Provider + Model setup",
			run: async (state) => {
				// No hardcoded models. The wizard prompts the operator.
				// In interactive mode, this step asks:
				//   1. "Enter your default model (provider/model format, e.g. ollama-cloud/nemotron-3-super):"
				//   2. "Do you want to assign different models to different agents? (y/n)"
				//   3. If yes, prompt for each agent's model
				// For non-interactive/testing, the operator must provide via state.config
				const defaultModel = state.config.default_model as string | undefined;
				if (!defaultModel && state.interactive) {
					console.log("  [Interactive] Prompt operator for default model (provider/model format)");
					console.log(
						"  Examples: ollama-cloud/nemotron-3-super, anthropic/claude-sonnet-4-6, openrouter/kimi-k2",
					);
					// In real implementation: readline prompt here
				}

				state.config.tier_routing = {
					default: defaultModel ?? "not-configured",
				};

				if (defaultModel) {
					console.log(`  Default model: ${defaultModel}`);
				} else {
					console.log("  No model configured yet. Set via 'mypensieve config edit'");
				}
			},
		},
		{
			name: "routing",
			description: "Per-agent model assignment",
			run: async (state) => {
				// This step handles multi-model assignment.
				// If the operator picked only 1 model in the previous step, use it for everything.
				// If they want different models per agent, prompt for each.
				const agentModels = state.config.agent_models as Record<string, string> | undefined;

				if (!agentModels && state.interactive) {
					console.log(
						"  [Interactive] Ask: 'Use the default model for all agents, or assign per-agent?'",
					);
					console.log(
						"  If per-agent: prompt for orchestrator, researcher, critic, devil-advocate models",
					);
				}

				if (agentModels) {
					console.log("  Per-agent model assignment:");
					for (const [agent, model] of Object.entries(agentModels)) {
						console.log(`    ${agent}: ${model}`);
					}
				} else {
					console.log("  All agents will use the default model");
				}
			},
		},
		{
			name: "embeddings",
			description: "Embeddings config",
			run: async (state) => {
				state.config.embeddings = { enabled: false };
				console.log("  Embeddings: disabled (enable via config for L4 semantic search)");
			},
		},
		{
			name: "channels",
			description: "Channel selection",
			run: async (state) => {
				state.config.channels = {
					cli: { enabled: true, tool_escape_hatch: false },
					telegram: { enabled: false, tool_escape_hatch: false },
				};
				console.log("  CLI: enabled");
				console.log("  Telegram: disabled (enable via config + provide bot token)");
			},
		},
		{
			name: "persona",
			description: "Persona seeding",
			run: async (state) => {
				// Three modes: questionnaire, free-form, skip
				// MVP defaults to skip - persona builds organically
				state.config.persona_mode = "skip";
				console.log("  Persona mode: skip (builds organically from sessions)");
				console.log(
					"  Change via 'mypensieve config edit' - options: questionnaire, freeform, skip",
				);
			},
		},
		{
			name: "review",
			description: "Review configuration",
			run: async (state) => {
				console.log("\n  Configuration summary:");
				console.log(`    Operator: ${(state.config.operator as Record<string, string>).name}`);
				console.log(`    Timezone: ${(state.config.operator as Record<string, string>).timezone}`);
				console.log(
					`    Channels: CLI${(state.config.channels as Record<string, { enabled: boolean }>).telegram?.enabled ? " + Telegram" : ""}`,
				);
				console.log(
					`    Embeddings: ${(state.config.embeddings as { enabled: boolean }).enabled ? "enabled" : "disabled"}`,
				);
				console.log(`    Persona: ${state.config.persona_mode}`);
			},
		},
		{
			name: "initialize",
			description: "Initialize directories + write config",
			run: async (state) => {
				// Scaffold directories
				const { created } = scaffoldDirectories();
				console.log(`  Created ${created.length} directories`);

				// Build and write config
				const config: Config = {
					version: 1,
					operator: state.config.operator as Config["operator"],
					tier_routing: state.config.tier_routing as Config["tier_routing"],
					embeddings: (state.config.embeddings as Config["embeddings"]) ?? { enabled: false },
					daily_log: {
						enabled: true,
						cron: "0 20 * * *",
						channel: "cli",
						auto_prompt_next_morning_if_missed: true,
					},
					backup: {
						enabled: true,
						cron: "30 2 * * *",
						retention_days: 30,
						destinations: [{ type: "local", path: "/tmp/mypensieve-backups" }],
						include_secrets: false,
					},
					channels: state.config.channels as Config["channels"],
					extractor: { cron: "0 2 * * *" },
				};

				writeConfig(config);
				console.log("  Config written to ~/.mypensieve/config.json");
				console.log("\n  MyPensieve initialized! Run 'mypensieve start' to begin.");
			},
		},
	];
}
