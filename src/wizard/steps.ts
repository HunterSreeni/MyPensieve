import type { AgentPersona, Config, PersonaMode } from "../config/schema.js";
import { writeConfig } from "../config/writer.js";
import { scaffoldDirectories } from "../init/directories.js";
import { installMyPensieveExtension } from "../init/extension-installer.js";
import { initGitRepo } from "../init/git-init.js";
import {
	writeOperatorTemplate,
	writePersonaFile,
	writePersonaTemplate,
} from "../init/persona-templates.js";
import { writeSecret } from "../init/secrets-writer.js";
import { captureError } from "../ops/index.js";
import {
	filterCloudModels,
	filterEmbeddingModels,
	getOllamaHost,
	probeOllama,
	renderOllamaSetupHelp,
} from "../providers/ollama.js";
import type { WizardStep } from "./framework.js";
import { ask, choose, closePrompt, confirm } from "./prompt.js";

export function createWizardSteps(): WizardStep[] {
	return [
		{
			name: "welcome",
			description: "Welcome + operator profile",
			run: async (state) => {
				console.log("\n  Welcome to MyPensieve!\n");
				const detectedName = process.env.USER ?? "operator";
				const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
				const tzValid = typeof detectedTz === "string" && detectedTz.length > 0;

				console.log(`  Detected name:     ${detectedName}`);
				console.log(
					`  Detected timezone: ${tzValid ? detectedTz : "(could not detect - will prompt)"}`,
				);

				const useDetected = tzValid ? await confirm("Use these values?", true) : false;

				let name: string;
				let timezone: string;
				if (useDetected) {
					name = detectedName;
					timezone = detectedTz;
				} else {
					name = await ask("Your name", detectedName);
					timezone = await ask(
						"Timezone (IANA format, e.g. Asia/Kolkata)",
						tzValid ? detectedTz : "UTC",
					);
				}

				state.config.operator = { name, timezone };
			},
		},
		{
			name: "providers",
			description: "AI Provider + Model setup (Ollama Cloud)",
			run: async (state) => {
				const host = getOllamaHost();
				console.log(`\n  Probing local Ollama daemon at ${host}...`);

				const probe = await probeOllama(host);
				if (!probe.ok) {
					captureError({
						severity: "critical",
						errorType: "ollama_probe",
						errorSrc: "wizard:provider",
						message: `Ollama daemon unreachable: ${probe.error ?? "unknown error"}`,
						context: { host, probeError: probe.error },
					});
					console.log(`  Probe failed: ${probe.error ?? "unknown error"}\n`);
					console.log(renderOllamaSetupHelp("not-running", host));
					console.log("");
					closePrompt();
					process.exit(1);
				}

				const cloudModels = filterCloudModels(probe.models);
				if (cloudModels.length === 0) {
					captureError({
						severity: "critical",
						errorType: "ollama_no_cloud_models",
						errorSrc: "wizard:provider",
						message: "Ollama reachable but no cloud models available",
						context: {
							host,
							totalModels: probe.models.length,
							modelNames: probe.models.map((m) => m.name),
						},
					});
					console.log("  Ollama is running but no cloud models are signed in.\n");
					console.log(renderOllamaSetupHelp("no-cloud-models", host));
					console.log("");
					closePrompt();
					process.exit(1);
				}

				console.log(`  Found ${cloudModels.length} cloud model(s):\n`);
				const picked = await choose(
					"Pick a default model",
					cloudModels.map((m) => m.name),
					0,
				);

				const modelString = `ollama/${picked}`;
				state.config.default_model = modelString;
				state.config.tier_routing = { default: modelString };
				console.log(`\n  Default model: ${modelString}`);
				console.log(`  Ollama host:   ${host} (set OLLAMA_HOST to override at runtime)`);
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
					"Enable L4 semantic search (requires a local embedding model)?",
					false,
				);
				state.config.embeddings = { enabled: enable };

				if (!enable) {
					console.log("  Embeddings: disabled");
					return;
				}

				const host = getOllamaHost();
				console.log(`\n  Probing ${host} for local embedding models...`);

				const probe = await probeOllama(host);
				if (!probe.ok) {
					captureError({
						severity: "high",
						errorType: "ollama_probe",
						errorSrc: "wizard:embeddings",
						message: `Embeddings probe failed: ${probe.error ?? "unknown error"}`,
						context: { host, probeError: probe.error },
					});
					console.log(`  Probe failed: ${probe.error ?? "unknown error"}`);
					console.log("  Skipping embeddings - you can enable later via 'mypensieve config edit'.");
					state.config.embeddings = { enabled: false };
					return;
				}

				const embedModels = filterEmbeddingModels(probe.models);

				if (embedModels.length === 0) {
					console.log("  No local embedding models detected.");
					console.log("  Install one with e.g.:");
					console.log("    ollama pull nomic-embed-text");
					console.log("    ollama pull mxbai-embed-large");
					console.log(
						"  Skipping embeddings for now - re-run 'mypensieve init --restart' after pulling one.",
					);
					state.config.embeddings = { enabled: false };
					return;
				}

				console.log(`  Found ${embedModels.length} embedding model(s):\n`);
				const picked = await choose(
					"Pick an embedding model",
					embedModels.map((m) => m.name),
					0,
				);

				state.config.embeddings = {
					enabled: true,
					provider: "ollama",
					model: picked,
				};
				console.log(`\n  Embeddings: ollama/${picked}`);
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
					// --- Step A: bot token ---
					console.log("\n  Step 1/3: Create the bot and get a token");
					console.log("    1. Open Telegram and start a chat with @BotFather");
					console.log("    2. Send /newbot and follow the prompts (pick a name + username)");
					console.log("    3. BotFather replies with a token that looks like:");
					console.log("         1234567890:ABCdefGhIJKlmNOpqrstUVWXYZ12345678");
					console.log("       (digits, a colon, then ~35 characters)");
					console.log("    4. While you're in BotFather also run:");
					console.log("         /setjoingroups -> Disable   (blocks group joins)");
					console.log("         /setprivacy    -> Enable    (hides group messages from the bot)");
					console.log("");

					const token = await ask("Paste the bot token (or press Enter to skip and add later)", "");
					if (token) {
						const tokenOk = /^\d+:[A-Za-z0-9_-]{20,}$/.test(token);
						if (!tokenOk) {
							console.log(
								`  Warning: '${token.slice(0, 8)}...' does not match the Telegram token format`,
							);
							console.log("  (expected: digits:alphanumeric, 20+ chars after the colon).");
							console.log("  Saving it anyway - edit later via 'mypensieve config edit'.");
						}
						try {
							const result = writeSecret("telegram.json", { bot_token: token });
							console.log(`  Token saved to ${result.path} (mode 0600)`);
						} catch (err) {
							const e = err instanceof Error ? err : new Error(String(err));
							console.log(`  Failed to save token: ${e.message}`);
							console.log(
								"  You can add it later by editing ~/.mypensieve/.secrets/telegram.json manually.",
							);
						}
					} else {
						console.log("  No token provided. Telegram channel is enabled in config but won't");
						console.log(
							"  actually connect until you add the token to ~/.mypensieve/.secrets/telegram.json",
						);
					}

					// --- Step B: your Telegram user ID (allowlist) ---
					console.log("\n  Step 2/3: Find your Telegram user ID for the allowlist");
					console.log("    1. Open Telegram and search for @userinfobot");
					console.log("    2. Start a chat and press Start");
					console.log("    3. It replies with 'Id: 123456789' - that number is your user ID");
					console.log("       (typically 8-10 digits, always numeric)");
					console.log("    4. Anyone not in this allowlist will be rejected by the bot");
					console.log("");

					const peerId = await ask("Your Telegram user ID (numeric, or press Enter to skip)", "");
					if (peerId) {
						if (!/^\d+$/.test(peerId)) {
							console.log(`  Warning: '${peerId}' doesn't look like a numeric Telegram ID.`);
							console.log("  Saving it anyway - you can edit later via 'mypensieve config edit'.");
						}
						(
							state.config.channels as { telegram: { allowed_peers: string[] } }
						).telegram.allowed_peers = [peerId];
						console.log(`  Peer ${peerId} added to allowed list`);
					} else {
						console.log("  No peer added. Bot will reject ALL messages until you add your ID.");
					}

					// --- Step C: reminder summary ---
					console.log("\n  Step 3/3: You're done with Telegram setup.");
					console.log("    - Bot token:   saved to .secrets/telegram.json");
					console.log("    - Allowlist:   your user ID only");
					console.log("    - Run 'mypensieve start' later to connect the bot.");
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

				const personaMode: PersonaMode = "skip";
				if (mode.startsWith("Guided")) {
					console.log("  [Questionnaire mode coming in v0.2.0]");
					console.log("  Using skip for now - persona builds from sessions");
				} else if (mode.startsWith("Free-form")) {
					console.log("  [Free-form mode coming in v0.2.0]");
					console.log("  Using skip for now - persona builds from sessions");
				} else {
					console.log("  Persona will build organically from your sessions");
				}
				state.config.persona_mode = personaMode;
			},
		},
		{
			name: "agent_identity",
			description: "Agent name + persona",
			run: async (state) => {
				console.log("\n  Now let's define your agent's identity.\n");
				console.log("  This controls how the AI introduces itself and interacts with you.");
				console.log("  You can change this anytime later - or skip and let the agent ask you");
				console.log("  on your first conversation.\n");

				const wantNow = await confirm("Define agent identity now?", true);

				if (!wantNow) {
					console.log("  Skipped - the agent will ask who it should be on first run.");
					state.config.agent_persona = undefined;
					return;
				}

				const name = await ask("Agent name (e.g. Pensieve, Jarvis, Nova)", "Pensieve");

				console.log(`\n  Describe ${name}'s personality and role in a few sentences.`);
				console.log("  Example: 'A concise, no-nonsense assistant that respects my time.");
				console.log("  Speaks directly, avoids filler, challenges bad ideas politely.'\n");

				const description = await ask(`${name}'s personality/role`, "");

				if (!description) {
					console.log("  No description provided - the agent will ask on first run.");
					state.config.agent_persona = undefined;
					return;
				}

				// Build a proper identity prompt from the name + description
				const identityPrompt = [
					`You are ${name}, a MyPensieve agent.`,
					"",
					description,
					"",
					"Keep responses concise. Respect the operator's time.",
					`Always identify as ${name} when asked who you are.`,
				].join("\n");

				state.config.agent_persona = {
					name,
					identity_prompt: identityPrompt,
					created_at: new Date().toISOString(),
				} satisfies AgentPersona;

				console.log(`\n  Agent identity set: ${name}`);
				console.log("  You can refine this later via 'mypensieve persona edit'");
				console.log("  or by telling the agent to change its persona in conversation.");
			},
		},
		{
			name: "review",
			description: "Review configuration",
			run: async (state) => {
				const op = state.config.operator as Record<string, string>;
				const channels = state.config.channels as Record<string, { enabled: boolean }>;
				const embeddings = state.config.embeddings as { enabled: boolean };

				const agentPersona = state.config.agent_persona as AgentPersona | undefined;

				console.log("\n  ---- Configuration Summary ----");
				console.log(`  Operator:    ${op.name}`);
				console.log(`  Timezone:    ${op.timezone}`);
				console.log(`  Model:       ${state.config.default_model ?? "not-configured"}`);
				console.log(`  Channels:    CLI${channels.telegram?.enabled ? " + Telegram" : ""}`);
				console.log(`  Embeddings:  ${embeddings.enabled ? "enabled" : "disabled"}`);
				console.log(`  Persona:     ${state.config.persona_mode}`);
				console.log(`  Agent:       ${agentPersona?.name ?? "(will ask on first run)"}`);
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
				let created: string[];
				try {
					({ created } = scaffoldDirectories());
				} catch (err) {
					const e = err instanceof Error ? err : new Error(String(err));
					captureError({
						severity: "critical",
						errorType: "directory_scaffold",
						errorSrc: "wizard:initialize",
						message: e.message,
						stack: e.stack,
					});
					throw err;
				}
				console.log(`  Created ${created.length} directories`);

				let extInstall: ReturnType<typeof installMyPensieveExtension>;
				try {
					extInstall = installMyPensieveExtension();
				} catch (err) {
					const e = err instanceof Error ? err : new Error(String(err));
					captureError({
						severity: "critical",
						errorType: "extension_install",
						errorSrc: "wizard:initialize",
						message: e.message,
						stack: e.stack,
					});
					throw err;
				}
				console.log(`  Pi extension bridge ${extInstall.action} at ${extInstall.bridgePath}`);

				// Write persona templates (or real persona if defined in wizard)
				const wizardPersona = state.config.agent_persona as AgentPersona | undefined;
				if (wizardPersona) {
					writePersonaFile(wizardPersona.name, wizardPersona.identity_prompt);
					console.log(`  Agent persona written: ${wizardPersona.name}`);
				} else {
					const tpl = writePersonaTemplate();
					if (tpl.written) {
						console.log(`  Agent persona template written to ${tpl.path}`);
					}
				}

				// Write operator persona template (pre-filled with name/timezone from wizard)
				const op2 = state.config.operator as { name?: string; timezone?: string };
				const opTpl = writeOperatorTemplate({ name: op2.name, timezone: op2.timezone });
				if (opTpl.written) {
					console.log(`  Operator persona template written to ${opTpl.path}`);
				}

				const config: Config = {
					version: 1,
					operator: state.config.operator as Config["operator"],
					default_model: state.config.default_model as Config["default_model"],
					agent_models: state.config.agent_models as Config["agent_models"],
					persona_mode: state.config.persona_mode as Config["persona_mode"],
					agent_persona: wizardPersona,
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

				try {
					writeConfig(config);
				} catch (err) {
					const e = err instanceof Error ? err : new Error(String(err));
					captureError({
						severity: "critical",
						errorType: "config_write",
						errorSrc: "wizard:initialize",
						message: e.message,
						stack: e.stack,
					});
					throw err;
				}
				console.log("  Config written to ~/.mypensieve/config.json");

				// Initialize git repo for version tracking
				const git = initGitRepo();
				if (git.initialized) {
					console.log("  Git repo initialized (tracks config/persona changes)");
				} else if (git.alreadyExists) {
					console.log("  Git repo already exists");
				} else if (git.error) {
					console.log(`  Git: ${git.error}`);
				}

				console.log("\n  MyPensieve initialized!\n");
				console.log("  Next steps:");
				console.log("    mypensieve start           Start the Telegram bot (always-on)");
				console.log("    mypensieve cli             Open an interactive CLI session");
				console.log("    mypensieve daemon install   Auto-start on boot (coming soon)\n");
				closePrompt();
			},
		},
	];
}
