# MyPensieve - Multi-Agent Runtime
> Status: LOCKED | Created: 2026-04-08 | Revised after Pi research + landscape research
> Companion to PI-FOUNDATION.md (read first), MEMORY-ARCHITECTURE.md, TOOLSHED-BRIDGE-ARCHITECTURE.md, PROVIDERS.md.
> This doc covers HOW MyPensieve handles agent personas, solo vs. council mode, and multi-POV deliberation.

**Important context:** Pi (the foundation - see PI-FOUNDATION.md) has **no native multi-agent council support**, **and that is by design, not an oversight.** Mario Zechner (Pi's author) explicitly rejects built-in multi-agent in [his Nov 2025 post](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) because sub-agents create "a black box within a black box". The intended pattern for multi-agent work is **host-side orchestration** via `pi-ai`'s `complete()`. The Cognition team (Devin) reached the same conclusion in [Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents): multi-agent systems fragment context and break observability; prefer single long-context agents with explicit context passing.

MyPensieve's council mode is **structurally identical to AutoGen's GroupChat pattern** (one shared message list, multiple personas, a manager picks the next speaker). This is the canonical way to implement peer-collaborative councils across the agentic CLI ecosystem. We are not inventing a new pattern - we are implementing AutoGen GroupChat semantics on top of `pi-ai` as the LLM client. This is locked as decision **N6**.

---

## WHY THIS DOC EXISTS

A general-purpose autonomous agent OS needs to support both:

1. **Solo mode** - one agent handling everything for the operator. Simple, cheap, the default for 90% of use cases.
2. **Council mode** - multiple agents with different POVs collaborating to refine a decision. Expensive, opt-in, for high-stakes choices that benefit from research-backed debate.

The original SREENI-OS master outline conflated "tier" (model class) with "agent" (persona). This doc separates them. **An agent is a configurable persona; a tier_hint is a capability class.** They are orthogonal.

---

## CORE CONCEPTS - HOW AGENTS DIFFER FROM SKILLS AND MCPs

| Concept | What it is | Lifecycle | When to use |
|---|---|---|---|
| **Skill** | A one-shot recipe with a fixed prompt and args. Stateless. Returns a result. | Single API call | Operator says "do this specific task" |
| **MCP** | An external tool process that provides capabilities (filesystem, github, web). | Spawned for a session, killed at end | Operator needs an external capability |
| **Agent** | A persona with system prompt, tier_hint, default toolset, and multi-turn capability. | Multi-turn within a session; can invoke skills and MCPs; can be convened in councils | Operator wants to talk to a specific role, OR a multi-POV decision is needed |
| **Council** | A collection of 2+ agents convened to deliberate on a specific topic. Phase-based, shared transcript, host-orchestrated. | Single deliberation (~30-90 seconds), then dissolved | Operator wants research-backed multi-POV refinement of a decision |

The user **talks to an agent** in interactive sessions. The agent **invokes skills** to do specific tasks. **Convenes a council** for high-stakes decisions. Agents are the persistent personas; skills are the one-shot operations they reach for; councils are ephemeral peer-collaborative deliberations.

---

## DEFAULT INSTALL: ONE AGENT (ORCHESTRATOR)

A fresh MyPensieve install ships with **exactly one agent**: the Orchestrator. This is enough for most users to start working immediately. No council, no Worker, no Intern, no decisions about agents - one entity, simple.

**Where agents live:** in Pi's agents directory at `~/.pi/agent/agents/<name>.md`. Pi already loads agents from this location for its own `subagent/` extension (chain and parallel modes). MyPensieve adds extended frontmatter fields for council mode. The same files are dual-usable as Pi sub-agents AND MyPensieve council members.

```
~/.pi/agent/agents/
└── orchestrator.md          # Single markdown file with frontmatter + body
```

Format:

```markdown
---
# Pi-native frontmatter (used by Pi's subagent extension)
name: orchestrator
description: Default solo agent - balanced planner that synthesizes, decides, delegates
model: claude-sonnet-4-6
tools: [read, bash, edit, write, grep, find, ls]

# MyPensieve extensions (Pi ignores these; council reads them)
mypensieve_tier_hint: deep
mypensieve_can_be_default: true
mypensieve_can_be_convened: true
mypensieve_token_budget: 30000
mypensieve_max_turns: 20
---

You are the Orchestrator, the default agent of MyPensieve...
(full system prompt as the body of this markdown file)
```

The frontmatter `model` field is what Pi's subagent extension uses for chain/parallel mode. MyPensieve's council mode ignores it and uses `mypensieve_tier_hint` → routing → resolved model instead.

After install, the operator runs:

```bash
mypensieve start
```

This is a thin wrapper that spawns Pi (via the SDK or as a subprocess) with MyPensieve's extensions loaded. The interactive session uses the Orchestrator as the default - the persona-injector extension prepends `~/.pi/agent/agents/orchestrator.md`'s body to the system prompt.

**No council. No second agent. Until the operator wants more.**

---

## ADDING MORE AGENTS (OPT-IN)

Users who want a workforce can add more agents:

```bash
mypensieve agent add researcher --template researcher
mypensieve agent add critic --template critic
mypensieve agent add intern --template intern
```

Or fully custom:

```bash
mypensieve agent add archivist --tier-hint standard --role "Maintains structured notes and cross-references"
```

Each command creates a single markdown file at `~/.pi/agent/agents/<name>.md` with the dual-format frontmatter (Pi-native fields + MyPensieve extensions) and the system prompt as the body.

The operator can `cat`, edit, and refine these files directly. Agents are fully filesystem-managed - the source of truth is the markdown file, no metadata DB.

### Agent templates shipped in MVP

| Template | Suggested tier_hint | Persona | Use case |
|---|---|---|---|
| `orchestrator` | `deep` | Balanced planner. Synthesizes, decides, delegates. | Default solo agent (always installed) |
| `researcher` | `standard` | Facts-first, web-grounded, cites sources. Does NOT make recommendations. | Council POV: gathers evidence |
| `critic` | `standard` | Skeptical, devil's advocate, finds risks and alternatives. | Council POV: challenges assumptions |
| `intern` | `minimal` | Cheap and fast. Monitoring, polling, format conversion, summarization. | Cron-driven background work |

These are starter manifests + system prompts. The operator edits them after install if desired.

---

## AGENT FILE FORMAT

A single markdown file per agent at `~/.pi/agent/agents/<name>.md`. The file has two parts: dual-purpose YAML frontmatter (Pi-native fields + MyPensieve extension fields) and a markdown body that is the system prompt.

```markdown
---
# Pi-native frontmatter (used by Pi's subagent extension for chain/parallel mode)
name: researcher
description: Facts-first evidence gatherer for council deliberations
model: claude-sonnet-4-6
tools: [read, web_fetch, web_search]

# MyPensieve extensions (Pi ignores; council reads)
mypensieve_tier_hint: standard
mypensieve_can_be_default: false
mypensieve_can_be_convened: true
mypensieve_token_budget: 20000
mypensieve_max_turns: 10
mypensieve_default_mcps: [web-fetch]
mypensieve_allowed_skills: [search-web, summarize-doc, fetch-paper]
mypensieve_denied_skills: [git-push, shell-exec]
---

You are the Researcher, a member of MyPensieve's council of agents.

Your role is evidence-gathering. You do not make decisions. You find facts,
cite sources, and present them clearly. You distinguish between primary
sources, secondary sources, and speculation. You are honest about what you
do not know.

When invoked in a council deliberation, you receive a topic and context.
Your output is a structured set of findings:

  ## Topic
  ## Key Facts
  ## Primary Sources
  ## Open Questions
  ## Context Operator Should Know

You have access to web tools (web_fetch, web_search) and the project's memory
(memory_query). You use them generously to ground your output in evidence.

You never fabricate citations. If you cannot find a source, you say so.
```

### Field semantics

| Field | Used by | Purpose |
|---|---|---|
| `name` | Both | Unique identifier |
| `description` | Both | One-line summary |
| `model` | **Pi only** | Specific model for Pi's `subagent/` chain/parallel modes. Ignored by MyPensieve council. |
| `tools` | Both | Tool list. Pi uses for sub-agent invocation; MyPensieve uses as default for council member's pi-ai call. |
| `mypensieve_tier_hint` | **MyPensieve only** | Capability class for council mode. Resolved via routing in config.json (see PROVIDERS.md). |
| `mypensieve_can_be_default` | **MyPensieve only** | If true, agent can be the session entry point |
| `mypensieve_can_be_convened` | **MyPensieve only** | If true, agent can participate in council mode |
| `mypensieve_token_budget` | **MyPensieve only** | Hard token cap per council turn |
| `mypensieve_max_turns` | **MyPensieve only** | Cap on multi-turn loops within a single agent invocation |
| `mypensieve_default_mcps` | **MyPensieve only** | MCPs to enable for this agent's council turns (if it needs tool access, the council orchestrator wraps it in `createAgentSession`) |
| `mypensieve_allowed_skills` / `mypensieve_denied_skills` | **MyPensieve only** | Skill allowlist (intersected with channel allowlist) |

### Agent overrides in user config

The operator can override per-agent in `~/.mypensieve/config.json`:

```json
{
  "overrides": {
    "agent:orchestrator": "claude/opus-4.6",
    "agent:critic": "ollama/qwen2.5:72b"
  }
}
```

This pins a specific provider/model for that agent, ignoring the routing table. Use sparingly.

---

## MODE 1: SOLO ORCHESTRATOR (THE DEFAULT)

Most sessions are solo. Operator opens a session, talks to the Orchestrator, the Orchestrator does the work.

```bash
mypensieve start
```

**What happens:**

1. Channel detected: `cli/<cwd-slug>`
2. Channel binding loaded → project resolved
3. L0 + personas + L2 (project state) loaded → ~5k tok wake-up
4. Orchestrator agent loaded:
   - Bridge reads `workspace/agents/orchestrator/manifest.json`
   - Resolves `tier_hint: deep` → routing → `claude/opus-4.6` (or whatever the user has)
   - Loads `workspace/agents/orchestrator/system-prompt.md` as the session's system prompt
   - Default tools and MCPs auto-loaded
5. Session starts. Operator interacts with the Orchestrator persona.
6. Orchestrator can invoke skills via `invoke_skill()` - skills run on whatever `tier_hint` their manifest declares (independent of the Orchestrator's tier_hint)

The operator sees one entity. One persistent persona. Skills run silently behind the scenes on whatever tier they need.

### Session-as-different-agent

The operator can open a session embodying any other configured agent:

```bash
mypensieve start --as researcher
```

This loads the Researcher agent as the session's primary persona. Useful when the operator wants direct access to a specific role (e.g., asking the Researcher to do focused research without going through the Orchestrator).

Only agents with `can_be_default: true` can be session entry points. By default, only `orchestrator` is. The operator can flip this in any agent's manifest.

---

## MODE 2: COUNCIL DELIBERATION (OPT-IN)

When the operator wants multiple POVs to weigh in on a decision, they invoke **council mode**. This is the killer feature for high-stakes choices that benefit from research + debate + critique + synthesis.

### Two ways to trigger council mode

**(a) From within a solo session, by asking the Orchestrator:**

```
Operator: "I need to decide whether to use SQLite or flat files for the index. 
           Convene the council on this."

Orchestrator: invoke_skill("deliberate", {
  topic: "SQLite vs flat files for the memory index",
  context: "MyPensieve memory architecture, ~100k records expected, cross-project queries needed",
  agents: ["researcher", "critic"]
})
```

**(b) Directly from the CLI:**

```bash
mypensieve deliberate "Should I use SQLite or flat files for the index?"
```

This is shorthand for invoking the `deliberate` skill from a fresh session.

Both paths run the same protocol.

### The deliberation protocol (MVP version)

Phase-based, sequential, **host-orchestrated**. The council orchestrator runs in the MyPensieve host process (typically inside the `council.ts` extension), holds a shared transcript array in memory, and calls `pi-ai`'s `complete()` directly for each agent turn. No `AgentSession` is spawned for council members - too heavy.

Each agent **sees the full growing transcript** when its turn comes. This is the difference from Pi's `subagent/` chain mode, which only passes a single `{previous}` slot, not a real growing conversation.

```
deliberate(topic, context, agents=[researcher, critic])
  │
  ├── Initialize: transcript = []
  │
  ├── Phase 1: RESEARCH (Researcher)
  │     ├── Load ~/.pi/agent/agents/researcher.md
  │     ├── Resolve mypensieve_tier_hint → routing → provider/model
  │     ├── Build messages = [system: researcher_body, user: topic+context]
  │     ├── If researcher needs tools: wrap in createAgentSession with custom tools
  │     │   Otherwise: pi_ai.complete(model, messages) directly
  │     ├── Append result to transcript
  │     └── Save research/<deliberation-id>/01-research.md
  │
  ├── Phase 2: ANALYSIS (each non-researcher agent in series)
  │     ├── For each agent:
  │     │     ├── Load their .md file
  │     │     ├── Resolve their tier_hint
  │     │     ├── Build messages = [system: agent_body, user: topic+context+full_transcript_so_far+"your turn to analyze"]
  │     │     ├── pi_ai.complete()
  │     │     ├── Append to transcript
  │     │     └── Save research/<deliberation-id>/02-analysis-<agent>.md
  │
  ├── Phase 3: CRITIQUE (Critic)
  │     ├── Load critic.md
  │     ├── Build messages = [system: critic_body, user: topic+context+full_transcript_so_far+"critique everything above"]
  │     ├── pi_ai.complete()
  │     ├── Append to transcript
  │     └── Save research/<deliberation-id>/03-critique.md
  │
  ├── Phase 4: SYNTHESIS (Orchestrator, or dedicated synthesizer)
  │     ├── Load orchestrator.md
  │     ├── Resolve tier_hint (typically "deep" - the highest-quality model available)
  │     ├── Build messages = [system: orchestrator_body, user: topic+context+full_transcript+"synthesize the council's deliberation"]
  │     ├── pi_ai.complete()
  │     ├── Append to transcript
  │     └── Save research/<deliberation-id>/04-synthesis.md
  │
  └── RESULT
      ├── Full council transcript persisted as JSONL at research/<deliberation-id>/transcript.jsonl
      ├── Phase outputs saved as individual markdown files in research/<deliberation-id>/
      ├── Recommendation extracted as a Decision record (memory)
      │   with method: "council" and links to the transcript files
      └── Returned to caller (the inviting session or CLI)
```

### Why host orchestration (not AgentSession spawning)

Pi's `AgentSession` is built around filesystem sessions, TUI wiring, and extension loading. For each council turn, that overhead is wasted - we just need one `complete()` call with a custom system prompt and the growing transcript as context.

| Concern | AgentSession spawning | Host orchestration with `pi-ai` (chosen) |
|---|---|---|
| Setup overhead per agent turn | Heavy (filesystem session, TUI, extensions) | Zero (one function call) |
| Inter-agent visibility | Zero (sessions are isolated) | Full (host owns the transcript) |
| Turn order control | Implicit | Explicit |
| Persistence | Forced (Pi writes JSONL) | Optional (we write what we want, where we want) |
| Tool use per agent | Always available | Only if we wrap that one in `createAgentSession` (selective) |
| Cost per turn | Higher | Lower |

### The exact call pattern (lifted from Pi's `handoff.ts`)

The pattern is verbatim what Pi's own `handoff.ts` extension uses (`/tmp/pi-mono/packages/coding-agent/examples/extensions/handoff.ts:99-103`). One `complete()` call per turn, per persona:

```typescript
import { complete } from "@mariozechner/pi-ai";

async function councilTurn(
  persona: AgentPersona,
  topic: string,
  context: string,
  transcript: TranscriptEntry[],
  abortSignal: AbortSignal,
): Promise<TurnResult> {
  // Resolve persona's tier_hint via routing (see PROVIDERS.md)
  const { provider, model } = resolveTierHint(persona.tier_hint, "agent", persona.name);
  const apiKey = await piAuthStorage.get(provider);

  // Build messages: system prompt is the persona's role,
  // user message contains topic, context, AND the full growing transcript
  const userMessage = formatPromptWithTranscript(topic, context, transcript, persona.name);

  const result = await complete(
    model,
    {
      systemPrompt: persona.systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    },
    {
      apiKey,
      headers: {},
      signal: abortSignal,  // Ctrl-C cancels the whole council
    },
  );

  return {
    agent: persona.name,
    content: result.content,
    tokens_in: result.usage.input_tokens,
    tokens_out: result.usage.output_tokens,
    timestamp: new Date().toISOString(),
  };
}
```

This is the **intended Pi pattern** for host-side multi-agent orchestration (per Mario's blog post). MyPensieve does not invent anything here.

### When an agent needs tools

For council members that need actual tool use (e.g. Researcher needs `web_fetch` and `web_search` to gather facts), the council orchestrator wraps **just that one agent's turn** in a `createAgentSession` call with `customTools` and an in-memory `SessionManager`. The transcript is passed as the initial user message. The session runs to completion, returns its final assistant message, and we append that to the council transcript. No persisted Pi session, no extension loading.

Everyone else (Critic, Synthesizer, Orchestrator) just uses bare `pi-ai.complete()`. Cheap, clean.

### Cognition's caution: full context per turn, no slicing

[Cognition's "Don't Build Multi-Agents"](https://cognition.ai/blog/dont-build-multi-agents) post warns that multi-agent systems fragment context. The mitigation is simple: **every persona must see the FULL shared transcript every turn**, not a per-persona slice. Pi's huge context window (200k+ tokens on Claude Sonnet/Opus) makes this cheap. Do not optimize prematurely by giving each persona only "their relevant" parts of the transcript - that destroys the council's value.

### Deliberation result schema

The `deliberate` skill returns a structured object the calling session can use:

```json
{
  "deliberation_id": "delib-2026-04-08-001",
  "topic": "SQLite vs flat files for the memory index",
  "agents_convened": ["researcher", "critic", "orchestrator"],
  "recommendation": "Use hybrid: JSONL source-of-truth + SQLite derived index",
  "confidence": "high",
  "rationale": "...",
  "alternatives": [
    {"option": "Pure SQLite", "view_from": "critic", "why_not": "..."},
    {"option": "Pure JSONL", "view_from": "researcher", "why_not": "..."}
  ],
  "dissenting_views": [
    {"agent": "critic", "concern": "..."}
  ],
  "research_artifacts": [
    "research/delib-2026-04-08-001/01-research.md",
    "research/delib-2026-04-08-001/02-analysis-orchestrator.md",
    "research/delib-2026-04-08-001/03-critique.md",
    "research/delib-2026-04-08-001/04-synthesis.md"
  ],
  "estimated_cost_usd": 0.32,
  "duration_seconds": 47
}
```

This object becomes the source for a regular Decision record in the active project's `decisions.jsonl`, with `decision_method: "council"` and `research_artifacts` linking back to the transcript files.

---

## TOKEN MATH FOR COUNCIL DELIBERATION

A council deliberation is **expensive**. It is opt-in for important decisions, not the default for every question.

Approximate per-deliberation cost (3 agents, 4 phases, MVP defaults):

| Phase | Calls | Avg input tokens | Avg output tokens |
|---|---|---|---|
| Research (Researcher, may include web tool turns) | 1 + ~3 tool turns | ~3k + ~2k each | ~2k |
| Analysis (per non-researcher agent) | 1 per agent | ~5k | ~1.5k |
| Critique (Critic) | 1 | ~8k | ~1.5k |
| Synthesis (Orchestrator) | 1 | ~12k | ~2k |
| **Total (3 agents, 4 phases)** | **~6-8 calls** | **~30-40k** | **~7-10k** |

At Claude Sonnet rates (~$3/M input, $15/M output): **~$0.20-0.30 per deliberation.**
At Ollama local: **$0** (just compute time).
At free OpenRouter models: **$0**.

The operator should reserve council mode for decisions worth a quarter-dollar. For everyday questions, the Orchestrator alone is enough.

---

## CHANNEL BINDING EXTENSIONS FOR AGENTS

Channel binding (defined in MEMORY-ARCHITECTURE.md) gains two optional fields for agent control:

```json
{
  "project": "mypensieve",
  "auto_bound": false,
  "bound_at": "2026-04-08T22:15:00+05:30",
  "allowed_skills": ["*"],
  "denied_skills": [],
  "allowed_mcps": ["filesystem", "telegram"],
  "denied_mcps": ["shell"],
  "allowed_agents": ["*"],
  "denied_agents": [],
  "max_council_size": 3,
  "council_allowed": true
}
```

This lets the operator say:

- "From this Telegram channel, only the Orchestrator agent can be invoked. No other agents." (denied_agents = everyone except orchestrator)
- "Council mode is disabled from this channel." (council_allowed: false)
- "Council mode is allowed but only with up to 3 agents." (max_council_size: 3)

These restrictions matter because council deliberations are expensive and could be triggered maliciously by a hostile message arriving on a public channel.

---

## RELATIONSHIP TO LOCKED DECISIONS

| Locked decision | How agents interact |
|---|---|
| **Memory (1, 2, 3)** | Council transcripts are saved to `research/`. Council decisions become regular decisions in `decisions.jsonl` with `decision_method: "council"`. Agents read project state at session start like any session. |
| **N1 (embeddings)** | Unaffected. Agents may invoke memory queries that use embeddings, but the agent itself does not care about embedding config. |
| **N2 (toolshed + bridge)** | Agents reuse the bridge's invocation infrastructure. The bridge gains a third tool `invoke_agent(name, prompt, args)` for invoking a configured agent. |
| **N3 (config layout)** | `config.json` `overrides` section can include `agent:<name>` entries to pin specific provider/model for an agent. |
| **N4 (provider abstraction)** | Agents declare `tier_hint` like skills do. The bridge resolves at invocation via the routing table. Agents are provider-agnostic. See [PROVIDERS.md](PROVIDERS.md). |

---

## BRIDGE TOOLS REVISITED

With agents added, the bridge surface grows by one tool:

| Bridge tool | Purpose | Token cost |
|---|---|---|
| `invoke_skill(name, args)` | Run a one-shot skill on its declared tier_hint | ~150 tok |
| `enable_mcp(name)` | Spawn an MCP for the session | ~120 tok |
| `invoke_agent(name, prompt)` *(present only when agents are configured)* | Call a configured agent with a one-shot prompt or convene a multi-turn sub-session | ~150 tok |

**Base bridge context: ~420 tok** (was ~300 in solo-without-extra-agents installs).

Council mode is **just a skill** (`deliberate`) that internally calls `invoke_agent(...)` multiple times across phases. No special runtime, no agent messaging layer, no shared state. The orchestration logic lives inside the `deliberate` skill's prompt + invocation pattern.

---

## KEY INVARIANT: COUNCIL IS A HOST FUNCTION, NOT AN AGENT RUNTIME

This is the simplification that makes the design implementable: **council mode is not a new runtime - it is a function in the MyPensieve host process.** No persistent agent processes. No agent-to-agent IPC. No new abstraction beyond "loop over agents, call pi-ai, share the transcript".

The `council.ts` extension registers a slash command (`/deliberate`) and exports a `CouncilManager` class (naming lifted from AutoGen's `GroupChatManager`). When invoked:

1. Parse args: topic, context, agents list (defaults from config), speaker selection strategy
2. Load each agent's `.md` file from `~/.pi/agent/agents/`
3. Initialize shared state: `transcript`, `researchFindings`, `critiques`, `draft`, `currentPhase`
4. Run the council loop until termination:
   - `selectNextSpeaker()` decides who speaks next (phase-driven by default)
   - Build messages with the agent's system prompt + topic + context + full transcript
   - Resolve `mypensieve_tier_hint` → routing → provider/model
   - Call `pi-ai.complete()` (or wrap in `createAgentSession` if tools needed)
   - Append result to transcript and any structured channel
   - Check termination condition (phase complete + max_round reached)
5. Persist the full transcript and structured channels to `~/.mypensieve/research/deliberations/<id>/`
6. Extract a decision record and write it to the active project's `decisions.jsonl`
7. Return result to caller

No new infrastructure beyond what `pi-ai` and the SDK already provide.

## ALIGNMENT WITH AUTOGEN GROUPCHAT (THE CANONICAL ANALOG)

MyPensieve's `CouncilManager` is structurally identical to AutoGen's `GroupChatManager`. We adopt AutoGen's vocabulary and API surface where possible so anyone familiar with AutoGen can read MyPensieve's council code without learning new terms.

### Speaker selection strategies

| Strategy | Meaning | When to use |
|---|---|---|
| `phase-driven` (default) | Fixed sequence: research → analysis → critique → synthesis. Each phase has assigned roles. | The standard structured deliberation. Most predictable, cheapest. |
| `round_robin` | Each persona speaks in turn until max_round | Open discussion without predefined phases |
| `auto` | A small selector LLM call picks the next speaker based on the transcript | Dynamic discussions where the natural next speaker depends on what was just said. More expensive (one extra LLM call per turn). |
| `manual` | Operator picks the next speaker via prompt | Interactive moderated councils. Useful for debugging deliberation logic. |

The phase-driven strategy is the default because it matches the most common use case (research-backed structured decision refinement) and has the most predictable cost.

### Termination conditions

Lifted from AutoGen's `max_round` + `is_termination_msg`:

```typescript
interface CouncilOptions {
  agents: string[];                       // names of agents to convene
  topic: string;
  context?: string;
  speakerSelection?: "phase-driven" | "round_robin" | "auto" | "manual";
  maxRounds?: number;                     // cap total speaker turns; default 12
  isTermination?: (transcript) => boolean; // optional custom termination
  abortSignal?: AbortSignal;
}
```

A council always terminates on one of:
1. Reaching the synthesis phase and synthesis is complete (phase-driven default)
2. `maxRounds` reached
3. Custom `isTermination` returns true
4. `abortSignal` triggered (Ctrl-C from operator)

### Structured channels (lifted from LangGraph Swarm)

Beyond the linear `transcript` array, the council manager maintains **named channels** for structured artifacts:

```typescript
interface CouncilState {
  transcript: TranscriptEntry[];          // full chronological message log
  researchFindings: ResearchArtifact[];   // structured facts from researcher phase
  critiques: Critique[];                  // structured concerns from critic phase
  draft: string | null;                   // current synthesis draft
  currentPhase: "research" | "analysis" | "critique" | "synthesis" | "done";
  metadata: { deliberationId, startedAt, ... };
}
```

This beats stuffing everything into one linear transcript - personas can write structured artifacts alongside the chat log, and downstream consumers (the decision extractor, the operator's dashboard) can read structured fields without re-parsing the transcript.

### Explicit handoff as a tool (lifted from OpenAI Agents SDK)

Even inside a phase-driven council, a persona can call `handoff_to(name)` if it decides another persona should speak next. Cheap to add (just one tool registered for council members), huge expressive power. Default behavior is phase-driven; handoff is the override.

### Checkpointer (lifted from LangGraph Swarm)

The council state is serialized to disk after each turn as JSONL at `~/.mypensieve/research/deliberations/<id>/checkpoints.jsonl`. This:
- Lets operator observe council progress in real-time (`tail -f`)
- Survives crashes mid-deliberation
- Provides post-mortem inspection
- Is forward-compatible with Pi's session viewer (same JSONL format)

### Publish/subscribe by role (inspired by MetaGPT)

Each persona's system prompt tells it which prior transcript entries to weight:
- Researcher → focus on the topic and context, ignore prior analysis
- Critic → weight all prior phases equally, look for weak spots
- Synthesizer → weight critique most heavily, then research, then analysis

This is implemented by the `formatPromptWithTranscript` function annotating each message with `phase` and `agent`, so the persona's system prompt can instruct it to focus on specific subsets. Avoids context overload as councils grow longer.

---

## WHAT SHIPS IN MVP

| Component | Status |
|---|---|
| Agent as first-class concept (filesystem entity) | ✅ |
| Default install: 1 agent (Orchestrator) | ✅ |
| `mypensieve agent add` command | ✅ |
| Agent templates: orchestrator, researcher, critic, intern | ✅ |
| `invoke_agent` bridge tool | ✅ |
| `deliberate` meta-skill (council mode) | ✅ (the killer feature) |
| Phase-based deliberation protocol | ✅ |
| Council transcripts in `research/` | ✅ |
| Council decisions extracted to `decisions.jsonl` | ✅ |
| Per-agent allowlists (skills, MCPs, channels) | ✅ |
| Channel binding extensions (`allowed_agents`, `council_allowed`, `max_council_size`) | ✅ |
| Cost tracking per agent invocation | ✅ |

## WHAT IS NOT IN MVP

| Component | Why deferred |
|---|---|
| **Real multi-turn agent debate** | Phases are sequential write-and-read; back-and-forth is v1.5+ |
| **Persistent inter-agent state** | Each council is one-shot; agents don't remember past councils. v1.5+ |
| **Concurrent agent execution** | Phases are sequential in MVP. Parallel for speed = v1.5+ |
| **Agent self-improvement** | Loop A applies to skill prompts only in MVP, not agent system prompts. v1.5+ |
| **Inter-channel agent handoffs** | Defer |
| **Agent marketplaces / sharing** | Defer to v2 |
| **Custom (non-fixed) agent roles in council** | MVP supports any combination of the four template roles plus custom-added agents; specialized council roles like "moderator" are v1.5+ |

---

## SUMMARY OF LOCKED CHOICES

| Aspect | Choice |
|---|---|
| Agent definition | Filesystem entity in `workspace/agents/<name>/` with AGENT.md + system-prompt.md + manifest.json |
| Default install | 1 agent (Orchestrator), more are opt-in |
| Solo mode | Default. One agent embodies the session. |
| Council mode | Opt-in via `deliberate` meta-skill or `mypensieve deliberate` CLI |
| Deliberation protocol | Phase-based sequential (research → analysis → critique → synthesis), MVP version |
| Agent model binding | `tier_hint` in manifest, resolved via routing (see PROVIDERS.md). No hardcoded models. |
| Bridge tool addition | `invoke_agent(name, prompt)` (only present when agents are configured) |
| Council storage | Full transcripts in `research/<deliberation-id>/`, decisions extracted to `decisions.jsonl` with `method: council` |
| Channel control | `allowed_agents`, `denied_agents`, `council_allowed`, `max_council_size` in binding.json |
| Cost ceiling | Each council ~$0.20-0.30 on cloud, $0 on local. Opt-in only. |

---

## HARD UNSOLVED PROBLEMS (NOT BLOCKING MVP)

1. **Quorum and disagreement** - What if agents fundamentally disagree? MVP: synthesis phase explicitly captures dissenting views. v1.5+: explicit "no consensus" outcome that flags the decision for operator review.

2. **Hallucinated agreement** - Agents may agree because they're trained similarly, not because the answer is correct. MVP mitigation: Critic role explicitly tries to break consensus. v1.5+: cross-provider council (one Claude agent + one Llama agent + one GPT agent) to reduce shared-bias risk.

3. **Council session resumption** - What if a council deliberation is interrupted mid-phase? MVP: ~~deliberations are atomic, on failure they rerun from scratch~~. **Updated:** the checkpointer pattern (lifted from LangGraph Swarm) provides phase-level checkpointing in MVP. Resumption is straightforward - read the latest checkpoint, restart from the next phase.

4. **Agent learning loop** - When the operator gives feedback on an agent's output, does the agent's system prompt evolve? MVP: no. v1.5+: yes, mirroring Loop A for skill prompts.

5. **Agent-to-agent direct messaging** - In a real multi-turn debate, agents would address each other directly. MVP: phases are sequential text passes; explicit `handoff_to` tool provides escape hatch. v1.5+: structured addressing with `@persona` mentions in transcripts.

---

## REFERENCES

External sources that inform this design:

| Source | What we lifted from it |
|---|---|
| [Mario Zechner - Pi blog post (Nov 2025)](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) | Design intent: multi-agent should be host-orchestrated, not built into the agent. |
| [Cognition - Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) | Caution: full context per turn, no per-persona slicing. |
| [AutoGen GroupChat](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/group-chat.html) | Naming (`Council`, `CouncilManager`), speaker selection API (`round_robin`, `auto`, `manual`), `max_round` + `is_termination_msg`. |
| [AutoGen Selector GroupChat](https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/selector-group-chat.html) | The `auto` speaker selection strategy with a small selector LLM call. |
| [LangGraph Swarm](https://github.com/langchain-ai/langgraph-swarm-py) | Structured shared state beyond messages (named channels), checkpointer pattern. |
| [LangGraph Supervisor](https://github.com/langchain-ai/langgraph-supervisor-py) | Hierarchical fallback if needed (not MVP). |
| [MetaGPT paper](https://arxiv.org/html/2308.00352v6) | Publish/subscribe by role concept; SOP-as-code (phases as state machine). |
| [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/) | Explicit `handoff_to(name)` as a tool. |
| [CrewAI Processes](https://docs.crewai.com/en/concepts/processes) | Reference for what NOT to do (sequential pipeline is too limited; hierarchical manager is what Pi already has via subagent). |
| [Pi's `examples/extensions/handoff.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/handoff.ts) | The exact `complete()` call pattern for host-side LLM invocation. Verbatim. |
| [Pi's `examples/extensions/subagent/`](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent) | The hierarchical sub-agent escape hatch (we use it for non-council patterns, not for councils). |
| [Claude Code Subagents docs](https://code.claude.com/docs/en/sub-agents) | Reference for how Anthropic frames sub-agent vs agent teams; we use the same persona-files-in-a-directory pattern. |

---

*Implementation note: when MyPensieve gets built, this doc is the contract. Any deviation must be a new locked decision documented here, not silent drift.*
