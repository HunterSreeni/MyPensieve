/**
 * Writes base template .md files during scaffolding so nothing starts empty.
 * The agent.md template has a known marker so the system can detect
 * "template-only" vs "real persona defined by the operator".
 */
import fs from "node:fs";
import { AGENT_PERSONA_PATH, DIRS, OPERATOR_PERSONA_PATH } from "../config/paths.js";

/** Marker string embedded in the template - used to detect "not yet personalized" */
export const PERSONA_TEMPLATE_MARKER = "<!-- TEMPLATE: awaiting operator personalization -->";

const AGENT_TEMPLATE = `${PERSONA_TEMPLATE_MARKER}
# Agent Persona

> This file defines who your MyPensieve agent is.
> On your first conversation, the agent will ask you to describe its identity.
> Once defined, this file and config.json are updated automatically.

## Name
(not yet set)

## Identity
(not yet set - the agent will ask you on first run)

## Notes
- Edit this file anytime to reshape your agent's personality
- Or tell the agent "change your persona to..." in conversation
- The agent reads this on every session start
`;

/**
 * Write the base agent persona template.
 * Only writes if the file doesn't already exist (preserves operator edits).
 */
export function writePersonaTemplate(): { written: boolean; path: string } {
	fs.mkdirSync(DIRS.persona, { recursive: true });

	if (fs.existsSync(AGENT_PERSONA_PATH)) {
		return { written: false, path: AGENT_PERSONA_PATH };
	}

	fs.writeFileSync(AGENT_PERSONA_PATH, AGENT_TEMPLATE, "utf-8");
	return { written: true, path: AGENT_PERSONA_PATH };
}

/**
 * Check if the agent.md file is still just the template (not personalized).
 */
export function isPersonaTemplate(): boolean {
	if (!fs.existsSync(AGENT_PERSONA_PATH)) return true;
	const content = fs.readFileSync(AGENT_PERSONA_PATH, "utf-8");
	return content.includes(PERSONA_TEMPLATE_MARKER);
}

/**
 * Write a real persona to the agent.md file (replaces the template).
 */
export function writePersonaFile(name: string, identityPrompt: string): void {
	const content = `# Agent Persona

## Name
${name}

## Identity
${identityPrompt}

## Notes
- Edit this file anytime to reshape your agent's personality
- Or tell the agent "change your persona to..." in conversation
- The agent reads this on every session start
- Last updated: ${new Date().toISOString()}
`;

	fs.mkdirSync(DIRS.persona, { recursive: true });
	fs.writeFileSync(AGENT_PERSONA_PATH, content, "utf-8");
}

// --- Operator Persona ---

const OPERATOR_TEMPLATE_CONTENT = `${PERSONA_TEMPLATE_MARKER}
# Operator Persona

> This file describes YOU - the human operator.
> The agent reads this to understand how to interact with you.
> It fills in details organically as it learns from your conversations,
> or you can edit it directly anytime.

## Name
(set during init)

## Role
(what you do - e.g. "Software engineer", "Student", "Researcher")

## Preferences
- Communication style: (e.g. "concise and direct", "detailed explanations")
- Response length: (e.g. "short", "medium", "detailed when needed")
- What annoys you: (things the agent should avoid)
- What you value: (things the agent should prioritize)

## Context
- Working hours: (when you're typically active)
- Current focus: (what you're working on right now)
- Domain expertise: (what you already know well)
- Learning areas: (what you're trying to learn)

## Notes
- The agent updates this file as it learns your preferences
- Edit directly anytime - changes take effect next session
- Tell the agent "remember that I prefer..." to trigger an update
`;

/**
 * Write the operator persona template.
 * Populates name and timezone from config if available.
 * Only writes if file doesn't exist (preserves edits).
 */
export function writeOperatorTemplate(opts?: {
	name?: string;
	timezone?: string;
}): { written: boolean; path: string } {
	fs.mkdirSync(DIRS.persona, { recursive: true });

	if (fs.existsSync(OPERATOR_PERSONA_PATH)) {
		return { written: false, path: OPERATOR_PERSONA_PATH };
	}

	let content = OPERATOR_TEMPLATE_CONTENT;

	// Pre-fill name and timezone if available from wizard
	if (opts?.name) {
		content = content.replace("(set during init)", opts.name);
	}
	if (opts?.timezone) {
		content = content.replace(
			"(when you're typically active)",
			`(when you're typically active) - Timezone: ${opts.timezone}`,
		);
	}

	fs.writeFileSync(OPERATOR_PERSONA_PATH, content, "utf-8");
	return { written: true, path: OPERATOR_PERSONA_PATH };
}

/**
 * Check if the operator.md file is still just the template.
 */
export function isOperatorTemplate(): boolean {
	if (!fs.existsSync(OPERATOR_PERSONA_PATH)) return true;
	const content = fs.readFileSync(OPERATOR_PERSONA_PATH, "utf-8");
	return content.includes(PERSONA_TEMPLATE_MARKER);
}

/**
 * Update the operator persona file (replaces template or existing content).
 */
export function writeOperatorFile(sections: {
	name: string;
	role?: string;
	preferences?: string;
	context?: string;
}): void {
	const content = `# Operator Persona

## Name
${sections.name}

## Role
${sections.role ?? "(not yet described)"}

## Preferences
${sections.preferences ?? "- (learning from conversations)"}

## Context
${sections.context ?? "- (builds over time)"}

## Notes
- The agent updates this file as it learns your preferences
- Edit directly anytime - changes take effect next session
- Tell the agent "remember that I prefer..." to trigger an update
- Last updated: ${new Date().toISOString()}
`;

	fs.mkdirSync(DIRS.persona, { recursive: true });
	fs.writeFileSync(OPERATOR_PERSONA_PATH, content, "utf-8");
}
