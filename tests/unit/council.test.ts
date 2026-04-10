import { describe, it, expect } from "vitest";
import { CouncilManager, type AgentPersona } from "../../src/council/manager.js";
import {
	ORCHESTRATOR, RESEARCHER, CRITIC, DEVIL_ADVOCATE,
	DEFAULT_AGENTS, AVAILABLE_AGENTS, getAgentByName, resolveAgentModel,
} from "../../src/council/personas.js";

const testAgents: AgentPersona[] = [
	{
		name: "researcher",
		description: "Gathers and analyzes information",
		model: "openrouter/test-model",
		canBeConvened: true,
		systemPrompt: "You are a researcher. Gather facts and present findings.",
	},
	{
		name: "critic",
		description: "Challenges assumptions and identifies risks",
		model: "openrouter/test-model",
		canBeConvened: true,
		systemPrompt: "You are a critic. Challenge assumptions, identify risks.",
	},
	{
		name: "orchestrator",
		description: "Synthesizes findings into actionable recommendations",
		model: "anthropic/claude-opus-4-6",
		canBeConvened: true,
		systemPrompt: "You are the orchestrator. Synthesize and recommend.",
	},
];

describe("CouncilManager", () => {
	it("runs a basic deliberation with 3 agents", async () => {
		const council = new CouncilManager({
			topic: "Should we use Redis or SQLite for caching?",
			agents: testAgents,
			speakerMode: "round_robin",
			maxRounds: 10,
		});

		const result = await council.deliberate();

		expect(result.deliberation_id).toBeDefined();
		expect(result.topic).toBe("Should we use Redis or SQLite for caching?");
		expect(result.agents).toHaveLength(3);
		expect(result.phases_completed).toBe(3);
		expect(result.total_rounds).toBeGreaterThan(0);
		expect(result.synthesis).toBeDefined();
	});

	it("tracks consensus when no dissent", async () => {
		const council = new CouncilManager({
			topic: "Simple question",
			agents: testAgents,
			speakerMode: "round_robin",
			maxRounds: 10,
		});

		const result = await council.deliberate();
		expect(result.consensus).toBe(true);
		expect(result.dissent).toHaveLength(0);
	});

	it("detects dissent from critic", async () => {
		const council = new CouncilManager({
			topic: "Risky decision",
			agents: testAgents,
			speakerMode: "round_robin",
			maxRounds: 10,
		});

		const result = await council.deliberate(async (agent, _transcript, phase) => {
			if (agent.name === "critic" && phase === "critique") {
				return "I disagree with the proposed approach. There are significant risks with this strategy.";
			}
			return `[${agent.name}] Phase: ${phase}`;
		});

		expect(result.consensus).toBe(false);
		expect(result.dissent.length).toBeGreaterThan(0);
		expect(result.dissent[0]).toContain("critic");
	});

	it("respects max_round limit", async () => {
		const council = new CouncilManager({
			topic: "Test",
			agents: testAgents,
			speakerMode: "round_robin",
			maxRounds: 3,
		});

		const result = await council.deliberate();
		expect(result.total_rounds).toBeLessThanOrEqual(3);
	});

	it("full transcript visible to every agent (Cognition rule)", async () => {
		const transcriptsSeen: Array<{ agent: string; turnCount: number }> = [];

		const council = new CouncilManager({
			topic: "Test visibility",
			agents: testAgents,
			speakerMode: "round_robin",
			maxRounds: 10,
		});

		await council.deliberate(async (agent, transcript, phase) => {
			transcriptsSeen.push({ agent: agent.name, turnCount: transcript.length });
			return `[${agent.name}] Seeing ${transcript.length} previous turns in ${phase}`;
		});

		// Each subsequent agent should see more transcript entries
		// (monotonically increasing, since each turn adds to transcript)
		for (let i = 1; i < transcriptsSeen.length; i++) {
			const prev = transcriptsSeen[i - 1]!;
			const curr = transcriptsSeen[i]!;
			expect(curr.turnCount).toBeGreaterThanOrEqual(prev.turnCount);
		}
	});

	it("populates structured channels", async () => {
		const council = new CouncilManager({
			topic: "Test channels",
			agents: testAgents,
			speakerMode: "round_robin",
			maxRounds: 10,
		});

		const result = await council.deliberate(async (agent, _t, phase) => {
			if (phase === "research") return "Research finding: SQLite is faster for small datasets";
			if (phase === "critique") return "No major concerns with this approach";
			return "- Use SQLite for MVP\n- Consider Redis for v2 if needed";
		});

		expect(result.structured_channels.researchFindings).toContain("SQLite");
		expect(result.structured_channels.draft).toBeDefined();
		expect(result.recommendations.length).toBeGreaterThan(0);
	});

	it("phase-driven speaker selection assigns different agents to phases", async () => {
		const phases: Array<{ agent: string; phase: string }> = [];

		const council = new CouncilManager({
			topic: "Test phase-driven",
			agents: testAgents,
			speakerMode: "phase-driven",
			maxRounds: 10,
		});

		await council.deliberate(async (agent, _t, phase) => {
			phases.push({ agent: agent.name, phase });
			return `[${agent.name}] ${phase}`;
		});

		// Research should go to "researcher" agent
		const researchPhases = phases.filter((p) => p.phase === "research");
		expect(researchPhases.some((p) => p.agent === "researcher")).toBe(true);

		// Critique should go to "critic" agent
		const critiquePhases = phases.filter((p) => p.phase === "critique");
		expect(critiquePhases.some((p) => p.agent === "critic")).toBe(true);
	});
});

describe("Agent personas", () => {
	it("default install ships 1 agent (Orchestrator)", () => {
		expect(DEFAULT_AGENTS).toHaveLength(1);
		expect(DEFAULT_AGENTS[0]?.name).toBe("orchestrator");
	});

	it("4 agents available total", () => {
		expect(AVAILABLE_AGENTS).toHaveLength(4);
		const names = AVAILABLE_AGENTS.map((a) => a.name);
		expect(names).toContain("orchestrator");
		expect(names).toContain("researcher");
		expect(names).toContain("critic");
		expect(names).toContain("devil-advocate");
	});

	it("all agents are convene-able", () => {
		expect(AVAILABLE_AGENTS.every((a) => a.canBeConvened)).toBe(true);
	});

	it("agents have no model by default (operator assigns)", () => {
		expect(ORCHESTRATOR.model).toBeUndefined();
		expect(RESEARCHER.model).toBeUndefined();
		expect(CRITIC.model).toBeUndefined();
	});

	it("resolveAgentModel uses agent model when set", () => {
		const agent = { ...ORCHESTRATOR, model: "ollama-cloud/nemotron-3-super" };
		expect(resolveAgentModel(agent)).toBe("ollama-cloud/nemotron-3-super");
	});

	it("resolveAgentModel falls back to default when no model set", () => {
		expect(resolveAgentModel(ORCHESTRATOR, "ollama/llama3")).toBe("ollama/llama3");
	});

	it("getAgentByName finds agents", () => {
		expect(getAgentByName("orchestrator")).toBeDefined();
		expect(getAgentByName("critic")?.name).toBe("critic");
		expect(getAgentByName("nonexistent")).toBeUndefined();
	});

	it("council works with shipped personas", async () => {
		const council = new CouncilManager({
			topic: "Test with shipped personas",
			agents: AVAILABLE_AGENTS,
			speakerMode: "round_robin",
			maxRounds: 12,
		});

		const result = await council.deliberate();
		expect(result.agents).toHaveLength(4);
		expect(result.phases_completed).toBe(3);
	});
});
