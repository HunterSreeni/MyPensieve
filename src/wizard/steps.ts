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
import { ask, choose, closePrompt, confirm, intro, note, outro, spin } from "./prompt.js";

// --- Provider setup helpers ---

const PROVIDER_MODEL_HINTS: Record<string, string> = {
	anthropic: "claude-sonnet-4-6",
	openrouter: "anthropic/claude-sonnet-4-6",
	openai: "gpt-4.1",
};

async function setupOllamaProvider(state: { config: Record<string, unknown> }): Promise<void> {
	const host = getOllamaHost();

	const probe = await spin(`Probing Ollama at ${host}`, () => probeOllama(host));
	if (!probe.ok) {
		captureError({
			severity: "critical",
			errorType: "ollama_probe",
			errorSrc: "wizard:provider",
			message: `Ollama daemon unreachable: ${probe.error ?? "unknown error"}`,
			context: { host, probeError: probe.error },
		});
		note(renderOllamaSetupHelp("not-running", host), "Ollama not reachable");
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
			context: { host, totalModels: probe.models.length },
		});
		note(renderOllamaSetupHelp("no-cloud-models", host), "No cloud models");
		closePrompt();
		process.exit(1);
	}

	const picked = await choose(
		`Pick a default model (${cloudModels.length} found)`,
		cloudModels.map((m) => m.name),
		0,
	);

	const modelString = `ollama/${picked}`;
	state.config.default_model = modelString;
	state.config.tier_routing = { default: modelString };
	note(`Model: ${modelString}\nHost: ${host}`, "Ollama configured");
}

async function setupApiKeyProvider(
	state: { config: Record<string, unknown> },
	providerName: string,
): Promise<void> {
	const hint = PROVIDER_MODEL_HINTS[providerName] ?? "model-id";

	const apiKey = await ask(`${providerName} API key`, "");
	if (!apiKey) {
		note(
			`No API key provided.\nYou can add it later to ~/.mypensieve/.secrets/${providerName}.json`,
			"Skipped",
		);
		// Still set the provider so config is valid - user adds key later
		const modelId = await ask(`Model ID (e.g. ${hint})`, hint);
		const modelString = `${providerName}/${modelId}`;
		state.config.default_model = modelString;
		state.config.tier_routing = { default: modelString };
		return;
	}

	// Validate the key with a quick probe
	const valid = await spin(`Validating ${providerName} API key`, async () => {
		try {
			const baseUrls: Record<string, string> = {
				anthropic: "https://api.anthropic.com/v1/models",
				openrouter: "https://openrouter.ai/api/v1/models",
				openai: "https://api.openai.com/v1/models",
			};
			const url = baseUrls[providerName];
			if (!url) return true; // Unknown provider - skip validation

			const headers: Record<string, string> =
				providerName === "anthropic"
					? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
					: { Authorization: `Bearer ${apiKey}` };

			const res = await fetch(url, {
				headers,
				signal: AbortSignal.timeout(5000),
			});
			return res.ok || res.status === 401 ? res.ok : true; // Non-401 errors are likely fine
		} catch {
			return true; // Network error - don't block wizard, user can fix later
		}
	});

	if (!valid) {
		note(
			"API key validation failed (401 Unauthorized).\nSaving anyway - you can update it later.",
			"Warning",
		);
	}

	// Save the key
	try {
		const result = writeSecret(`${providerName}.json`, { api_key: apiKey });
		note(`API key saved to ${result.path} (mode 0600)`, "Saved");
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		note(`Failed to save key: ${e.message}\nAdd it manually later.`, "Error");
	}

	const modelId = await ask(`Model ID (e.g. ${hint})`, hint);
	const modelString = `${providerName}/${modelId}`;
	state.config.default_model = modelString;
	state.config.tier_routing = { default: modelString };
	note(`Provider: ${providerName}\nModel: ${modelString}`, "Provider configured");
}

function buildConfig(state: { config: Record<string, unknown> }): Config {
	const wizardPersona = state.config.agent_persona as AgentPersona | undefined;
	return {
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
}

function scaffoldWithCapture(): { created: string[] } {
	try {
		return scaffoldDirectories();
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
}

function installExtensionWithCapture(): ReturnType<typeof installMyPensieveExtension> {
	try {
		return installMyPensieveExtension();
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
}

async function setupTelegramChannel(state: { config: Record<string, unknown> }): Promise<void> {
	note(
		"1. Open Telegram, start a chat with @BotFather\n" +
			"2. Send /newbot and follow the prompts\n" +
			"3. Copy the token (digits:alphanumeric)\n" +
			"4. Also run: /setjoingroups -> Disable, /setprivacy -> Enable",
		"Step 1/3: Create bot",
	);

	const token = await ask("Paste the bot token (or press Enter to skip)", "");
	if (token) {
		const tokenOk = /^\d+:[A-Za-z0-9_-]{20,}$/.test(token);
		if (!tokenOk) {
			note(`'${token.slice(0, 8)}...' doesn't match expected format.\nSaving anyway.`, "Warning");
		}
		try {
			const result = writeSecret("telegram.json", { bot_token: token });
			note(`Token saved to ${result.path} (mode 0600)`, "Saved");
		} catch (err) {
			const e = err instanceof Error ? err : new Error(String(err));
			note(`Failed: ${e.message}\nAdd it manually later.`, "Error");
		}
	} else {
		note("No token provided.\nAdd it later to ~/.mypensieve/.secrets/telegram.json", "Skipped");
	}

	note(
		"1. Open Telegram, search for @userinfobot\n" +
			"2. Start a chat and press Start\n" +
			"3. Copy the numeric ID it replies with",
		"Step 2/3: Your Telegram user ID",
	);

	const peerId = await ask("Your Telegram user ID (numeric, or Enter to skip)", "");
	if (peerId) {
		if (!/^\d+$/.test(peerId)) {
			note(`'${peerId}' doesn't look numeric. Saving anyway.`, "Warning");
		}
		(state.config.channels as { telegram: { allowed_peers: string[] } }).telegram.allowed_peers = [
			peerId,
		];
	} else {
		note("No peer added. Bot will reject ALL messages until you add your ID.", "Warning");
	}

	note(
		"Bot token saved, allowlist set.\nRun 'mypensieve start' later to connect.",
		"Step 3/3: Done",
	);
}

// --- Wizard steps ---

export function createWizardSteps(): WizardStep[] {
	return [
		{
			name: "welcome",
			description: "Welcome + operator profile",
			run: async (state) => {
				intro("MyPensieve Setup");

				const detectedName = process.env.USER ?? "operator";
				const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
				const tzValid = typeof detectedTz === "string" && detectedTz.length > 0;

				if (tzValid) {
					note(`Name: ${detectedName}\nTimezone: ${detectedTz}`, "Detected");
				}

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
			description: "AI Provider + Model setup",
			run: async (state) => {
				const provider = await choose(
					"Choose your AI provider",
					[
						"Ollama (local/cloud via daemon)",
						"Anthropic (Claude API)",
						"OpenRouter (multi-model gateway)",
						"OpenAI (GPT/o-series API)",
					],
					0,
				);

				const providerName = provider.startsWith("Ollama")
					? "ollama"
					: provider.startsWith("Anthropic")
						? "anthropic"
						: provider.startsWith("OpenRouter")
							? "openrouter"
							: "openai";

				if (providerName === "ollama") {
					await setupOllamaProvider(state);
				} else {
					await setupApiKeyProvider(state, providerName);
				}
			},
		},
		{
			name: "routing",
			description: "Per-agent model assignment (multi-model council)",
			run: async (state) => {
				const defaultModel = state.config.default_model as string | undefined;

				if (!defaultModel) {
					note("Skipping - no default model set", "Per-agent routing");
					return;
				}

				const perAgent = await confirm("Assign different models to council agents?", false);

				if (!perAgent) {
					note(`All agents will use: ${defaultModel}`, "Council models");
					return;
				}

				note(
					"Each agent can use a different provider/model.\n" +
						"Format: provider/model-id\n" +
						"Examples: ollama/nemotron-3-super:cloud, anthropic/claude-sonnet-4-6,\n" +
						"          openrouter/google/gemini-2.5-pro, openai/gpt-4.1\n" +
						"Press Enter to use the default.",
					"Multi-model council",
				);

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

				const summary = Object.entries(state.config.agent_models as Record<string, string>)
					.map(([agent, model]) => `${agent}: ${model}`)
					.join("\n");
				note(summary, "Council model assignments");
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
				note("CLI channel is always enabled.", "Channels");
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
					await setupTelegramChannel(state);
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

				note(
					`Operator:    ${op.name}\n` +
						`Timezone:    ${op.timezone}\n` +
						`Model:       ${state.config.default_model ?? "not-configured"}\n` +
						`Channels:    CLI${channels.telegram?.enabled ? " + Telegram" : ""}\n` +
						`Embeddings:  ${embeddings.enabled ? "enabled" : "disabled"}\n` +
						`Persona:     ${state.config.persona_mode}\n` +
						`Agent:       ${agentPersona?.name ?? "(will ask on first run)"}`,
					"Configuration Summary",
				);

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
				const { created } = scaffoldWithCapture();
				console.log(`  Created ${created.length} directories`);

				const extInstall = installExtensionWithCapture();
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

				const config = buildConfig(state);
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

				outro("MyPensieve initialized!");
				note(
					"mypensieve start           Start the Telegram bot (always-on)\n" +
						"mypensieve cli             Open an interactive CLI session\n" +
						"mypensieve daemon install   Auto-start on boot\n" +
						"mypensieve doctor install   Auto-healthcheck every 3 days",
					"Next steps",
				);
				closePrompt();
			},
		},
	];
}
