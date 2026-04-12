/**
 * Custom Pi AgentTool: save_persona
 *
 * Called by the agent during the first-run bootstrap flow.
 * When no persona exists, the agent asks the user "who should I be?" and then
 * calls this tool to persist the identity to config.
 */
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { readConfig, writeConfig } from "../../config/index.js";
import { CONFIG_PATH } from "../../config/paths.js";
import { commitState } from "../../init/git-init.js";
import { writePersonaFile } from "../../init/persona-templates.js";

const savePersonaSchema = Type.Object({
	name: Type.String({
		description:
			"A short display name for the agent identity (e.g. 'Pensieve', 'Jarvis', 'Nova')",
	}),
	identity_prompt: Type.String({
		description:
			"The full identity prompt that defines who you are, your role, personality, " +
			"tone, and how you interact with the operator. Write this in first person " +
			"as instructions to yourself. Be specific about your name, role, boundaries, " +
			"and communication style.",
	}),
});

type SavePersonaInput = Static<typeof savePersonaSchema>;

export const savePersonaTool: AgentTool<typeof savePersonaSchema> = {
	name: "save_persona",
	label: "Save Agent Persona",
	description:
		"Persist your agent identity/persona to the MyPensieve config. " +
		"Call this after the operator has described who you should be. " +
		"This saves the identity so it is injected on every future session.",
	parameters: savePersonaSchema,
	async execute(
		_toolCallId: string,
		params: SavePersonaInput,
	): Promise<{ content: { type: "text"; text: string }[]; details: unknown }> {
		const config = readConfig();

		config.agent_persona = {
			name: params.name,
			identity_prompt: params.identity_prompt,
			created_at: new Date().toISOString(),
		};

		writeConfig(config, CONFIG_PATH);

		// Also write the persona .md file (replaces template)
		writePersonaFile(params.name, params.identity_prompt);

		// Commit the persona change
		commitState(`persona: set agent identity to "${params.name}"`);

		return {
			content: [
				{
					type: "text",
					text:
						`Persona saved successfully. Agent name: "${params.name}". ` +
						"This identity will be loaded on every future session. " +
						"The operator can update it later with 'mypensieve persona edit'.",
				},
			],
			details: { name: params.name, saved: true },
		};
	},
};
