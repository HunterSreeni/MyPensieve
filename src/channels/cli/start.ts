import {
	AuthStorage,
	InteractiveMode,
	SessionManager,
	codingTools,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "@mariozechner/pi-coding-agent";
import { ConfigReadError, readConfig } from "../../config/index.js";
import { PI_DIRS } from "../../config/paths.js";
import { parseModelString, resolveDefaultModel } from "../../config/schema.js";
import { validateChannelBinding } from "../../gateway/binding-validator.js";
import { createToolGuard } from "../../core/security/tool-guard.js";
import { savePersonaTool } from "../../core/tools/persona-tool.js";
import { isPersonaTemplate } from "../../init/persona-templates.js";
import { captureError, withCapture } from "../../ops/index.js";
import { getOllamaHost, registerOllamaProvider } from "../../providers/ollama.js";

/**
 * Start an interactive CLI session.
 *
 * Wires MyPensieve config -> Pi agent runtime:
 *   1. Load + validate MyPensieve config
 *   2. Resolve the default model (currently Ollama Cloud only)
 *   3. Build a Pi runtime factory that registers the Ollama provider on
 *      the cwd-bound ModelRegistry before creating the session
 *   4. Hand off to Pi's InteractiveMode for the TUI loop
 *
 * The MyPensieve Pi extension bridge (installed by `mypensieve init`) is
 * auto-discovered by Pi from ~/.pi/agent/extensions/mypensieve/, so session
 * lifecycle hooks (session_start, context, turn_end, session_shutdown) fire
 * automatically once the runtime starts.
 */
export async function startCliSession(opts?: { configPath?: string }): Promise<void> {
	// Step 1: Load config
	let config: import("../../config/schema.js").Config;
	try {
		config = readConfig(opts?.configPath);
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "config_read",
			errorSrc: "start:config",
			message: e.message,
			stack: e.stack,
			context: { configPath: opts?.configPath ?? "default" },
		});
		if (err instanceof ConfigReadError) {
			console.error(err.message);
			console.error("Run 'mypensieve init' to set up your configuration.");
			process.exitCode = 1;
			return;
		}
		throw err;
	}

	// Step 2: Validate channel
	try {
		validateChannelBinding("cli", config.channels);
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "channel_validation",
			errorSrc: "start:channel",
			message: e.message,
			stack: e.stack,
			context: { channel: "cli" },
		});
		console.error("Channel validation failed:", e.message);
		process.exitCode = 1;
		return;
	}

	// Step 3: Resolve the default model from config
	let modelString: string;
	let provider: string;
	let modelId: string;
	try {
		modelString = resolveDefaultModel(config);
		const parsed = parseModelString(modelString);
		provider = parsed.provider;
		modelId = parsed.modelId;
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "model_resolution",
			errorSrc: "start:model",
			message: e.message,
			stack: e.stack,
			context: {
				default_model: config.default_model,
				tier_routing_default: config.tier_routing.default,
			},
		});
		console.error(e.message);
		process.exitCode = 1;
		return;
	}

	if (provider !== "ollama") {
		captureError({
			severity: "high",
			errorType: "provider_unsupported",
			errorSrc: "start:model",
			message: `Provider '${provider}' is not wired up yet`,
			context: { provider, modelId, modelString },
		});
		console.error(
			`Provider '${provider}' is not wired up yet. Only 'ollama' is supported in this build.`,
		);
		console.error("Run 'mypensieve init --restart' to pick an Ollama Cloud model.");
		process.exitCode = 1;
		return;
	}

	const ollamaHost = getOllamaHost();

	// Step 4: Build Pi runtime factory.
	// The factory runs once for the initial session and again on /new, /resume,
	// /fork, etc. We register the Ollama provider on each services.modelRegistry
	// instance before resolving the model and creating the session.
	const authStorage = AuthStorage.create();
	const cwd = process.cwd();
	const agentDir = PI_DIRS.root;
	const sessionManager = SessionManager.create(cwd);

	const createRuntime: Parameters<typeof createAgentSessionRuntime>[0] = async ({
		cwd: runtimeCwd,
		agentDir: runtimeAgentDir,
		sessionManager: runtimeSessionManager,
		sessionStartEvent,
	}) => {
		const services = await createAgentSessionServices({
			cwd: runtimeCwd,
			agentDir: runtimeAgentDir,
			authStorage,
		});

		await withCapture(
			{
				errorSrc: "start:register-ollama",
				errorType: "provider_registration",
				severity: "critical",
				context: { host: ollamaHost, modelId },
			},
			async () => {
				registerOllamaProvider(services.modelRegistry, ollamaHost, modelId);
			},
		);

		const model = services.modelRegistry.find(provider, modelId);
		if (!model) {
			const err = new Error(
				`Model ${provider}/${modelId} not found in registry after registration. ` +
					"This is a bug in the Ollama provider registration.",
			);
			captureError({
				severity: "critical",
				errorType: "model_not_found",
				errorSrc: "start:model-lookup",
				message: err.message,
				context: { provider, modelId },
			});
			throw err;
		}

		// Include save_persona tool when persona hasn't been set or is still template-only
		const needsPersona = !config.agent_persona || isPersonaTemplate();
		const tools = needsPersona
			? [...codingTools, savePersonaTool]
			: codingTools;

		const created = await createAgentSessionFromServices({
			services,
			sessionManager: runtimeSessionManager,
			sessionStartEvent,
			model,
			tools,
		});

		// Surface extension load errors so the user sees broken bridges up front
		// instead of silently losing lifecycle hooks. Matches Pi's own main loop.
		const extensionErrors = services.resourceLoader
			.getExtensions()
			.errors.map(({ path: extPath, error }) => ({
				type: "error" as const,
				message: `Failed to load extension "${extPath}": ${error}`,
			}));
		const diagnostics = [...services.diagnostics, ...extensionErrors];

		return { ...created, services, diagnostics };
	};

	// Step 5: Create the runtime
	let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>>;
	try {
		runtime = await createAgentSessionRuntime(createRuntime, {
			cwd,
			agentDir,
			sessionManager,
		});
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		captureError({
			severity: "critical",
			errorType: "runtime_creation",
			errorSrc: "start:runtime",
			message: e.message,
			stack: e.stack,
			context: { cwd, agentDir, host: ollamaHost, modelId },
		});
		console.error("[mypensieve] Failed to create agent runtime:", e.message);
		process.exitCode = 1;
		return;
	}

	for (const diag of runtime.diagnostics) {
		const prefix =
			diag.type === "error"
				? "[mypensieve] ERROR:"
				: diag.type === "warning"
					? "[mypensieve] WARN:"
					: "[mypensieve] INFO:";
		console.error(prefix, diag.message);

		const severity = diag.type === "error" ? "high" : diag.type === "warning" ? "medium" : "info";
		captureError({
			severity,
			errorType: "runtime_diagnostic",
			errorSrc: "start:diagnostic",
			message: diag.message,
			context: { diagType: diag.type },
		});
	}
	if (runtime.diagnostics.some((d) => d.type === "error")) {
		process.exitCode = 1;
		return;
	}

	// Install filesystem security guardrails
	runtime.session.agent.beforeToolCall = createToolGuard(cwd);

	console.log(`[mypensieve] Model: ${modelString} via ${ollamaHost}`);
	console.log("[mypensieve] Entering Pi interactive mode. Ctrl+C to exit.");

	// Step 6: Hand off to Pi's interactive TUI.
	// Any failure inside the TUI loop is captured before being re-thrown so we
	// get a durable record even when Pi tears down the terminal.
	const interactiveMode = new InteractiveMode(runtime, {
		modelFallbackMessage: runtime.modelFallbackMessage,
	});
	await withCapture(
		{
			errorSrc: "start:interactive-mode",
			errorType: "runtime_tui",
			severity: "critical",
			context: { modelString, host: ollamaHost },
		},
		() => interactiveMode.run(),
	);
}
