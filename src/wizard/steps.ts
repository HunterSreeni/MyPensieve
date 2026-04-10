import type { Config } from "../config/schema.js";
import { writeConfig } from "../config/writer.js";
import { scaffoldDirectories } from "../init/directories.js";
import type { WizardStep } from "./framework.js";
import { ask, choose, closePrompt, confirm } from "./prompt.js";

export function createWizardSteps(): WizardStep[] {
	return [
		{
			name: "welcome",
			description: "Welcome + operator profile",
			run: async (state) => {
				console.log("\n  Welcome to MyPensieve!\n");
				const defaultName = process.env.USER ?? "operator";
				const defaultTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

				const name = await ask("Your name", defaultName);
				const timezone = await ask("Timezone", defaultTz);

				state.config.operator = { name, timezone };
			},
		},
		{
			name: "project",
			description: "Default project directory",
			run: async (state) => {
				const defaultDir = process.cwd();
				const dir = await ask("Default project directory", defaultDir);
				state.config.default_project = dir;
			},
		},
		{
			name: "providers",
			description: "AI Provider + Model setup",
			run: async (state) => {
				console.log("\n  Enter your default model in provider/model format.");
				console.log("  Examples:");
				console.log("    ollama-cloud/nemotron-3-super");
				console.log("    anthropic/claude-sonnet-4-6");
				console.log("    openrouter/kimi-k2");
				console.log("    ollama/llama3 (local)\n");

				const model = await ask("Default model", "");

				if (model) {
					state.config.default_model = model;
					state.config.tier_routing = { default: model };
					console.log(`  Default model set: ${model}`);
				} else {
					state.config.tier_routing = { default: "not-configured" };
					console.log("  No model set. Configure later via 'mypensieve config edit'");
				}
			},
		},
		{
			name: "routing",
			description: "Per-agent model assignment",
			run: async (state) => {
				const defaultModel = state.config.default_model as string | undefined;

				if (!defaultModel) {
					console.log("  Skipping per-agent assignment (no default model set)");
					return;
				}

				const perAgent = await confirm("Assign different models to different agents?", false);

				if (perAgent) {
					console.log("\n  Enter model for each agent (press Enter to use default):\n");

					const orchestrator = await ask("Orchestrator model", defaultModel);
					const researcher = await ask("Researcher model", defaultModel);
					const critic = await ask("Critic model", defaultModel);
					const devilAdvocate = await ask("Devil's Advocate model", defaultModel);

					state.config.agent_models = {
						orchestrator,
						researcher,
						critic,
						"devil-advocate": devilAdvocate,
					};

					console.log("\n  Per-agent models:");
					for (const [agent, model] of Object.entries(
						state.config.agent_models as Record<string, string>,
					)) {
						console.log(`    ${agent}: ${model}`);
					}
				} else {
					console.log(`  All agents will use: ${defaultModel}`);
				}
			},
		},
		{
			name: "embeddings",
			description: "Embeddings config (L4 semantic search)",
			run: async (state) => {
				const enable = await confirm(
					"Enable L4 semantic search (requires embedding model)?",
					false,
				);
				state.config.embeddings = { enabled: enable };

				if (enable) {
					const provider = await ask("Embedding provider", "ollama");
					const model = await ask("Embedding model", "nomic-embed-text");
					state.config.embeddings = { enabled: true, provider, model };
					console.log(`  Embeddings: ${provider}/${model}`);
				} else {
					console.log("  Embeddings: disabled");
				}
			},
		},
		{
			name: "channels",
			description: "Channel selection",
			run: async (state) => {
				console.log("  CLI channel is always enabled.\n");
				const enableTelegram = await confirm("Enable Telegram channel?", false);

				state.config.channels = {
					cli: { enabled: true, tool_escape_hatch: false },
					telegram: {
						enabled: enableTelegram,
						tool_escape_hatch: false,
						allowed_peers: [],
						allow_groups: false,
					},
				};

				if (enableTelegram) {
					console.log("\n  To finish Telegram setup:");
					console.log("    1. Create a bot via @BotFather");
					console.log("    2. Add bot token to ~/.mypensieve/.secrets/telegram.json");
					console.log("    3. Run /setjoingroups -> Disable in BotFather");
					console.log("    4. Run /setprivacy -> Enable in BotFather\n");

					const peerId = await ask("Your Telegram user ID (or press Enter to skip)", "");
					if (peerId) {
						(
							state.config.channels as { telegram: { allowed_peers: string[] } }
						).telegram.allowed_peers = [peerId];
						console.log(`  Peer ${peerId} added to allowed list`);
					}
				}
			},
		},
		{
			name: "persona",
			description: "Persona seeding",
			run: async (state) => {
				const mode = await choose(
					"How would you like to seed your persona?",
					[
						"Guided questionnaire (~5 min)",
						"Free-form text (~2 min)",
						"Skip (builds organically from sessions)",
					],
					2,
				);

				if (mode.startsWith("Guided")) {
					console.log("  [Questionnaire mode coming in v0.2.0]");
					console.log("  Using skip for now - persona builds from sessions");
					state.config.persona_mode = "skip";
				} else if (mode.startsWith("Free-form")) {
					console.log("  [Free-form mode coming in v0.2.0]");
					console.log("  Using skip for now - persona builds from sessions");
					state.config.persona_mode = "skip";
				} else {
					state.config.persona_mode = "skip";
					console.log("  Persona will build organically from your sessions");
				}
			},
		},
		{
			name: "review",
			description: "Review configuration",
			run: async (state) => {
				const op = state.config.operator as Record<string, string>;
				const channels = state.config.channels as Record<string, { enabled: boolean }>;
				const embeddings = state.config.embeddings as { enabled: boolean };

				console.log("\n  ---- Configuration Summary ----");
				console.log(`  Operator:    ${op.name}`);
				console.log(`  Timezone:    ${op.timezone}`);
				console.log(`  Model:       ${state.config.default_model ?? "not-configured"}`);
				console.log(`  Channels:    CLI${channels.telegram?.enabled ? " + Telegram" : ""}`);
				console.log(`  Embeddings:  ${embeddings.enabled ? "enabled" : "disabled"}`);
				console.log(`  Persona:     ${state.config.persona_mode}`);
				console.log("  -------------------------------\n");

				const ok = await confirm("Look good? Proceed with setup?", true);
				if (!ok) {
					console.log("  Aborted. Run 'mypensieve init --restart' to start over.");
					closePrompt();
					process.exit(0);
				}
			},
		},
		{
			name: "initialize",
			description: "Initialize directories + write config",
			run: async (state) => {
				const { created } = scaffoldDirectories();
				console.log(`  Created ${created.length} directories`);

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
				console.log("\n  MyPensieve initialized! Run 'mypensieve start' to begin.\n");
				closePrompt();
			},
		},
	];
}
