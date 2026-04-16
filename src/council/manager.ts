import crypto from "node:crypto";
import type { CouncilResult } from "../memory/types.js";
import { loadCouncilPersonality } from "./personality-loader.js";

export type SpeakerMode = "phase-driven" | "round_robin" | "auto" | "manual";

export interface AgentPersona {
	name: string;
	description: string;
	/** Direct model assignment: "provider/model" (e.g. "ollama-cloud/nemotron-3-super", "anthropic/claude-sonnet-4-6").
	 *  If not set, falls back to config.tier_routing default. */
	model?: string;
	/** @deprecated Use `model` instead. Kept as fallback key into tier_routing config. */
	tierHint?: string;
	canBeConvened: boolean;
	systemPrompt: string;
}

export interface CouncilConfig {
	topic: string;
	agents: AgentPersona[];
	speakerMode: SpeakerMode;
	maxRounds: number;
	checkpointPath?: string;
}

export interface AgentTurn {
	agent: string;
	phase: string;
	content: string;
	timestamp: string;
}

/**
 * Council Manager.
 * Orchestrates multi-agent deliberation using shared transcript.
 * Structurally identical to AutoGen GroupChat.
 *
 * Every persona sees the FULL shared transcript every turn (Cognition rule).
 */
export class CouncilManager {
	private config: CouncilConfig;
	private transcript: AgentTurn[] = [];
	private structuredChannels: Record<string, string> = {};

	constructor(config: CouncilConfig) {
		this.config = config;
	}

	/**
	 * Run a full deliberation.
	 * Returns the council result with consensus tracking.
	 *
	 * In full implementation, each agent turn calls pi-ai.complete()
	 * with the shared transcript + agent's system prompt.
	 * MVP simulates the framework.
	 */
	async deliberate(
		agentResponder?: (
			agent: AgentPersona,
			transcript: AgentTurn[],
			phase: string,
		) => Promise<string>,
	): Promise<CouncilResult> {
		const deliberationId = `council-${crypto.randomUUID()}`;
		const phases = this.getPhases();
		let roundCount = 0;

		for (const phase of phases) {
			const speakers = this.selectSpeakers(phase);

			for (const speaker of speakers) {
				if (roundCount >= this.config.maxRounds) break;

				const agent = this.config.agents.find((a) => a.name === speaker);
				if (!agent) continue;

				// Build the full prompt: protocol (from TS) + personality (from .md or default)
				const personality = loadCouncilPersonality(agent.name);
				const fullAgent: AgentPersona = {
					...agent,
					systemPrompt: personality
						? `${agent.systemPrompt}\n\n[Personality]\n${personality}`
						: agent.systemPrompt,
				};

				// Get agent response (real = pi-ai.complete, test = mock)
				const content = agentResponder
					? await agentResponder(fullAgent, this.transcript, phase)
					: `[${agent.name}] Response for phase "${phase}" on topic "${this.config.topic}"`;

				const turn: AgentTurn = {
					agent: agent.name,
					phase,
					content,
					timestamp: new Date().toISOString(),
				};

				this.transcript.push(turn);
				roundCount++;

				// Update structured channels based on phase
				if (phase === "research") {
					this.structuredChannels.researchFindings = `${this.structuredChannels.researchFindings ?? ""}\n${content}`;
				} else if (phase === "critique") {
					this.structuredChannels.critiques = `${this.structuredChannels.critiques ?? ""}\n${content}`;
				} else if (phase === "synthesis") {
					this.structuredChannels.draft = content;
				}
			}
		}

		// Analyze consensus
		const { consensus, dissent } = this.analyzeConsensus();

		const result: CouncilResult = {
			deliberation_id: deliberationId,
			timestamp: new Date().toISOString(),
			topic: this.config.topic,
			agents: this.config.agents.map((a) => a.name),
			phases_completed: phases.length,
			total_rounds: roundCount,
			synthesis: this.structuredChannels.draft ?? this.transcript.at(-1)?.content ?? "",
			consensus,
			dissent,
			recommendations: this.extractRecommendations(),
			structured_channels: this.structuredChannels,
		};

		return result;
	}

	private getPhases(): string[] {
		return ["research", "critique", "synthesis"];
	}

	private selectSpeakers(phase: string): string[] {
		const agents = this.config.agents.filter((a) => a.canBeConvened);

		switch (this.config.speakerMode) {
			case "round_robin":
				return agents.map((a) => a.name);

			case "phase-driven": {
				// Phase-driven: different agents lead different phases
				if (phase === "research") {
					return agents
						.filter((a) => a.name.includes("researcher") || a.name === agents[0]?.name)
						.map((a) => a.name);
				}
				if (phase === "critique") {
					return agents
						.filter((a) => a.name.includes("critic") || a.name === agents[1]?.name)
						.map((a) => a.name);
				}
				// Synthesis: orchestrator or first agent
				return [agents[0]?.name ?? "orchestrator"];
			}
			default:
				return agents.map((a) => a.name);
		}
	}

	private analyzeConsensus(): { consensus: boolean; dissent: string[] } {
		const dissent: string[] = [];

		// Simple heuristic: check if any critique phase content contains
		// strong disagreement markers
		const critiques = this.transcript.filter((t) => t.phase === "critique");
		for (const c of critiques) {
			const lowerContent = c.content.toLowerCase();
			if (
				lowerContent.includes("disagree") ||
				lowerContent.includes("concern") ||
				lowerContent.includes("risk") ||
				lowerContent.includes("alternative")
			) {
				dissent.push(`agent:${c.agent} - ${c.content.slice(0, 200)}`);
			}
		}

		return {
			consensus: dissent.length === 0,
			dissent,
		};
	}

	private extractRecommendations(): string[] {
		const synthesis = this.transcript.filter((t) => t.phase === "synthesis");
		if (synthesis.length === 0) return [];

		// Extract lines that look like recommendations
		const lastSynthesis = synthesis.at(-1)?.content ?? "";
		return lastSynthesis
			.split("\n")
			.filter((line) => line.trim().startsWith("-") || line.trim().startsWith("*"))
			.map((line) => line.trim().replace(/^[-*]\s*/, ""));
	}

	/** Get the full transcript (for Cognition rule verification) */
	getTranscript(): readonly AgentTurn[] {
		return this.transcript;
	}
}
