import {
	type AgentSession,
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
	codingTools,
	createAgentSession,
} from "@mariozechner/pi-coding-agent";

import { type Config, readConfig } from "../config/index.js";

export interface MyPensieveSessionOptions {
	/** Working directory for this session */
	cwd?: string;
	/** Channel type (affects binding validation and escape hatch) */
	channelType: "cli" | "telegram";
	/** Override config path (for testing) */
	configPath?: string;
	/** Additional Pi session options (pass-through) */
	piOptions?: Partial<CreateAgentSessionOptions>;
}

export interface MyPensieveSession {
	/** The underlying Pi AgentSession */
	piSession: AgentSession;
	/** Pi extension result */
	extensionsResult: CreateAgentSessionResult["extensionsResult"];
	/** The loaded config */
	config: Config;
	/** Channel type for this session */
	channelType: "cli" | "telegram";
	/** Project binding slug (e.g. "cli/my-project") */
	projectBinding: string;
}

/**
 * Generate a project binding slug from channel type and cwd.
 */
export function getProjectBinding(channelType: string, identifier: string): string {
	// Normalize path to a slug: /home/user/project -> home-user-project
	const slug = identifier
		.replace(/^\//, "")
		.replace(/\//g, "-")
		.replace(/[^a-zA-Z0-9_-]/g, "_");
	return `${channelType}/${slug}`;
}

/**
 * Create a MyPensieve session wrapping Pi's AgentSession.
 * This is the main entry point for starting an interactive session.
 *
 * - Loads and validates config
 * - Sets up Pi session with coding tools
 * - Passes through any additional Pi options
 */
export async function createMyPensieveSession(
	options: MyPensieveSessionOptions,
): Promise<MyPensieveSession> {
	const cwd = options.cwd ?? process.cwd();
	const config = readConfig(options.configPath);

	const projectBinding = getProjectBinding(options.channelType, cwd);

	const piOptions: CreateAgentSessionOptions = {
		cwd,
		tools: codingTools,
		...options.piOptions,
	};

	const result = await createAgentSession(piOptions);

	return {
		piSession: result.session,
		extensionsResult: result.extensionsResult,
		config,
		channelType: options.channelType,
		projectBinding,
	};
}
