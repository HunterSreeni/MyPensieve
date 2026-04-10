# MyPensieve - Pi as Foundation
> Status: LOCKED | Created: 2026-04-08 | Verified 2026-04-08 against current Pi codebase
> **Read this FIRST** - it is the load-bearing decision that shapes every other doc in this folder.
> Companion to MEMORY-ARCHITECTURE.md, TOOLSHED-BRIDGE-ARCHITECTURE.md, PROVIDERS.md, MULTI-AGENT-RUNTIME.md.

---

## TL;DR

**MyPensieve is built on top of Pi (`@mariozechner/pi-coding-agent`).** We do not write our own agent loop, provider abstraction, OAuth flow, session persistence, skills system, compaction, or extension API - **Pi already provides all of those**. MyPensieve is:

1. **A host process** that uses Pi as a library (via `createAgentSession` from the SDK, or directly via `pi-ai`'s `complete()` for non-session use cases like council deliberation)
2. **A bundle of Pi extensions** auto-installed into `~/.pi/agent/extensions/mypensieve/` providing the things Pi does not have: persistent cross-session memory, projects, channel binding, MCP client, council deliberation, cost tracking, decision extraction, persona injection
3. **A set of channel adapters** (CLI, Telegram, Discord, etc.) that **embed Pi in-process via `createAgentSession`**, modeled on how `pi-mom`'s Slack adapter works. RPC mode (`runRpcMode`) is available as an optional process-isolation alternative but is not the primary pattern.
4. **A namespace under `~/.mypensieve/`** for our own data (memory, projects, indexes, secrets specific to our channels)

**No fork. No patches to Pi. We track upstream and pin specific versions.**

This decision is locked as **N5**. The companion decision **N6** is that council/multi-agent mode is implemented as host-orchestrated calls to `pi-ai` directly (not via `AgentSession` spawning), structurally identical to AutoGen GroupChat semantics. See MULTI-AGENT-RUNTIME.md for the council architecture.

### Design intent anchors

Two external posts establish that MyPensieve's approach is mainstream and aligned with Pi's intent, not a workaround:

1. **Mario Zechner (Pi's author): "What I learned building an opinionated and minimal coding agent"** - https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
   States explicitly: "pi does not have a dedicated sub-agent tool" because sub-agents create "a black box within a black box" - you cannot see what spawned agents actually do. Pi's philosophy: **multi-agent scenarios should be deliberately orchestrated by the user (or host process), not automatic, with full observability.** The intended pattern for multi-agent work is host-side orchestration via `pi-ai`'s `complete()` - exactly what MyPensieve's council mode does.

2. **Cognition (Devin team): "Don't Build Multi-Agents"** - https://cognition.ai/blog/dont-build-multi-agents
   The Devin team reached the same conclusion: multi-agent systems fragment context and make debugging impossible. **Prefer single long-context agents with explicit context passing** over emergent multi-agent orchestration. MyPensieve's council mode follows this: every persona sees the FULL shared transcript every turn, no per-persona context slices.

These two posts together are the **design-intent anchor** for everything in this folder. When in doubt about how something should work in MyPensieve, the answer usually flows from "what does Pi want?" (Mario's post) and "how do we avoid the multi-agent debugging trap?" (Cognition's post).

---

## WHAT PI ACTUALLY IS

**Pi** is `@mariozechner/pi-coding-agent` - an interactive terminal coding agent by Mario Zechner (badlogic). MIT license. Published to npm. Active development. In the same category as Claude Code, Aider, OpenAI Codex CLI.

But pi-mono is much more than a CLI - it is a **full programmable SDK** organized as a TypeScript monorepo:

| Package | What it provides |
|---|---|
| `@mariozechner/pi-ai` | Multi-provider abstraction with **10+ providers built in**: Anthropic (with **OAuth via Claude Max plan**), OpenAI, Google Gemini + gemini-cli, Google Vertex, Azure OpenAI, Amazon Bedrock, Mistral, GitHub Copilot, OpenAI Codex Responses, faux. Built-in OAuth flow at `packages/ai/src/oauth.ts` and `packages/ai/src/utils/oauth/anthropic.ts`. |
| `@mariozechner/pi-agent-core` | Provider-agnostic agent loop (`agent-loop.ts`), streaming event bus, tool-call validation |
| `@mariozechner/pi-coding-agent` | The `pi` CLI + SDK + extension runtime + session manager + TUI modes |
| `@mariozechner/pi-tui` | Custom terminal UI library (differential rendering, overlays, editors) |
| `@mariozechner/pi-mom` | Slack adapter (proves the channel-adapter pattern - drives Pi over RPC) |
| `@mariozechner/pi-pods` | vLLM GPU deployment CLI (irrelevant to MyPensieve) |
| `@mariozechner/pi-web-ui` | Web chat components (irrelevant to MyPensieve for now) |

**Tech stack:** TypeScript, ESM, Node ≥20, npm workspaces, Vitest, Biome, optional Bun single-binary build (`build:binary`).

---

## WHY PI

Five reasons MyPensieve is built on Pi rather than from scratch:

1. **Pi already does ~70% of what we planned to build.** Provider abstraction, OAuth, sessions, skills, compaction, extension API, agent loop - all production-quality and already shipped.
2. **Time to MVP drops dramatically.** We focus on what makes MyPensieve unique (memory, projects, channels, council, MCP client) instead of reimplementing infrastructure.
3. **The extension API is sufficient** for everything we need. We do not need to fork or patch Pi.
4. **Pi's design philosophy aligns with ours.** Minimal opinionated core, everything else as documented extension points. Provider-agnostic. File-based. CLI-friendly.
5. **The skills format is essentially ours.** Pi already implements the Agent Skills spec (markdown + YAML frontmatter, lazy catalog injection via `formatSkillsForPrompt`). Our skills are portable to anyone running Pi.

---

## THE SPLIT - WHAT PI OWNS, WHAT MYPENSIEVE OWNS

| Concern | Owner | Notes |
|---|---|---|
| Agent loop (read/bash/edit/write iteration) | **Pi** | `pi-agent-core/agent-loop.ts` and `coding-agent/core/agent-session.ts` |
| Provider adapters (Anthropic, OpenRouter, Gemini, etc.) | **Pi** | All 10+ providers in `pi-ai/providers/`. We use this directly. |
| OAuth flow + credential storage | **Pi** | `AuthStorage` at `~/.pi/agent/auth.json` (mode 0600), Anthropic OAuth done |
| Session persistence (raw transcripts) | **Pi** | JSONL trees at `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<id>.jsonl`, branches/forks/resume/migration |
| Skills system | **Pi** | Markdown+YAML at `~/.pi/agent/skills/` and `./.pi/skills/`, lazy catalog via `formatSkillsForPrompt` |
| Tool registration | **Pi** | `customTools` parameter + extension `defineTool` |
| Compaction | **Pi** | Pluggable via `SessionBeforeCompactEvent` |
| Sub-agents (chain/parallel modes) | **Pi** | `examples/extensions/subagent/` - we may use this for non-council patterns |
| Slash commands | **Pi** | `slash-commands.ts`, registerable from extensions |
| TUI rendering | **Pi** | `pi-tui` |
| Extension API | **Pi** | ~80 example extensions, jiti loader, lifecycle events |
| Settings management | **Pi** | `~/.pi/agent/settings.json` |
| --- | --- | --- |
| **5-layer persistent memory** (decisions, facts, threads, personas) | **MyPensieve** | New extension. Pi has nothing here. |
| **Filesystem-as-registry projects + state.md per project** | **MyPensieve** | New convention layer + extension |
| **Channel binding** (CLI / Telegram / Discord with allowlists) | **MyPensieve** | Each channel = host process driving Pi via RPC. Pattern proven by `pi-mom`. |
| **MCP client support** | **MyPensieve** | The one real gap in Pi. Built as a `dynamic-tools.ts`-pattern extension. |
| **Council multi-agent deliberation** | **MyPensieve** | Host-orchestrated via `pi-ai`'s `complete()`. See N6 below. |
| **Cost tracking + audit log + decision extraction** | **MyPensieve** | New extension subscribing to `BeforeProviderRequestEvent` + `TurnEndEvent` |
| **Persona files** (user.md / llm.md) | **MyPensieve** | New convention. Loaded into Pi's system prompt via extension. |
| **Embedding subsystem (L4)** | **MyPensieve** | Pi has no embedding code. We build this independently. |

---

## WHERE THINGS LIVE - TWO ROOTS

### `~/.pi/agent/` - Pi's home (Pi owns these)

```
~/.pi/agent/
├── auth.json                    # OAuth tokens + API keys (mode 0600, Pi-managed)
├── settings.json                # Pi runtime settings
├── sessions/                    # Raw session JSONL trees
│   └── <encoded-cwd>/
│       └── <timestamp>_<id>.jsonl
├── skills/                      # User skills (Agent Skills spec)
│   ├── medium-draft/
│   │   └── SKILL.md
│   └── ...
├── agents/                      # Sub-agent definitions (and council members)
│   ├── researcher.md
│   ├── critic.md
│   └── ...
└── extensions/
    ├── mypensieve/              # MyPensieve's extension bundle
    │   ├── package.json
    │   ├── memory.ts
    │   ├── projects.ts
    │   ├── channel-binding.ts
    │   ├── mcp-client.ts
    │   ├── council.ts
    │   ├── cost-tracking.ts
    │   ├── decision-extractor.ts
    │   ├── persona-injector.ts
    │   └── permission-gate.ts
    └── (other extensions the user has installed)
```

### `~/.mypensieve/` - MyPensieve's home (we own these)

```
~/.mypensieve/
├── config.json                  # MyPensieve config (mode 0444, see N3)
├── .secrets/                    # Non-AI secrets (Telegram bot token, etc.) - mode 0700
│   ├── telegram_bot_token
│   └── ...
├── projects/                    # Filesystem-as-registry, see MEMORY-ARCHITECTURE.md
│   ├── untagged/
│   └── <project-name>/
├── channels/                    # Channel bindings, see MEMORY-ARCHITECTURE.md
│   ├── cli/
│   ├── telegram/
│   └── discord/
├── workspace/                   # Identity + personas
│   ├── identity.md
│   └── personas/
│       ├── user.md
│       ├── llm.md
│       └── history/
├── index/                       # Derived SQLite indexes (rebuildable)
│   ├── memory.sqlite
│   ├── facts.sqlite
│   └── embeddings.sqlite
├── research/                    # Hash-addressed research artifacts + council transcripts
│   └── <hash>.md
├── digests/                     # Synthesized weekly/monthly summaries
│   ├── weekly/
│   └── monthly/
└── logs/
    ├── errors/
    ├── decisions/
    ├── cost/
    └── audit/                   # Bridge audit log
```

**Key principle:** Pi-related state lives in `~/.pi/`. MyPensieve-related state lives in `~/.mypensieve/`. Each tool owns its dir. Backup, migration, deletion of one does not corrupt the other.

**Skills are an exception:** they live in `~/.pi/agent/skills/` because that is where Pi looks for them. MyPensieve does not duplicate them. We ship skills as part of our install, copying them into Pi's skills dir.

---

## THE EXTENSION BUNDLE

MyPensieve ships as **one bundled extension package** dropped into `~/.pi/agent/extensions/mypensieve/`. The bundle contains many TypeScript modules, each implementing one capability via Pi's extension API. They share state via the MyPensieve namespace (`~/.mypensieve/`) and a shared in-process service registry.

| Module | What it does | Pi hooks used |
|---|---|---|
| `memory.ts` | Captures every turn, writes structured records to `~/.mypensieve/projects/<active>/` | `TurnEndEvent`, `SessionShutdownEvent` |
| `projects.ts` | Resolves channel binding to active project, loads project state.md into context | `AgentStartEvent`, `BeforeProviderRequestEvent` |
| `channel-binding.ts` | Reads channel binding files, enforces project routing | `AgentStartEvent` |
| `mcp-client.ts` | Connects to configured MCP servers, registers their tools as Pi tools | `defineTool` registration + `dynamic-tools.ts` pattern |
| `council.ts` | Implements `deliberate` slash command and council orchestration via `pi-ai` direct calls | Slash command registration; bypasses AgentSession entirely |
| `cost-tracking.ts` | Logs every provider request to `logs/cost/<date>.json` | `BeforeProviderRequestEvent`, `TurnEndEvent` |
| `decision-extractor.ts` | Post-session pass that reads Pi's session JSONL and writes decisions/facts/threads | `SessionShutdownEvent`, plus standalone cron job |
| `persona-injector.ts` | Loads `workspace/personas/{user,llm}.md` and prepends to system prompt | `BeforeProviderRequestEvent` |
| `permission-gate.ts` | Channel-aware allowlists for tools, skills, MCPs, council, agents | `BeforeToolCallEvent` (or equivalent) |

**Single npm package, multiple files.** Operator runs `mypensieve install` once; the install command auto-creates `~/.pi/agent/extensions/mypensieve/` and writes the bundle there. Pi loads it via jiti at next startup.

---

## CHANNEL ADAPTERS (THE OTHER HALF)

The CLI is the easy case: a thin wrapper that calls `mypensieve start`, which boots Pi's interactive TUI mode in the current terminal with our extensions loaded.

Non-CLI channels (Telegram, Discord, future WhatsApp/Slack) are **separate daemon processes** that **embed Pi in-process** via `createAgentSession` from `@mariozechner/pi-coding-agent`'s SDK. This is how `pi-mom` (the Slack adapter) actually works. The earlier assumption that pi-mom uses `runRpcMode` was wrong - verified by reading `/tmp/pi-mono/packages/mom/src/agent.ts:4, 468`.

```
┌─────────────────────────┐
│  mypensieve-telegram    │  ← long-running daemon (Node.js)
│  ────────────────────   │
│  Listens on Telegram    │
│  bot API                │
│  For each (chat, peer): │
│    createAgentSession({ │
│      cwd, customTools,  │
│      authStorage, ...   │
│    })                   │
│    Send messages to it  │
│    in-process           │
│    Pump events back to  │
│    Telegram             │
│    Enforce binding/     │
│    allowlist            │
└─────────────────────────┘
```

Each channel adapter:
- Has its own daemon process (one process per channel type, NOT per peer)
- Reads `~/.mypensieve/channels/<type>/<id>/binding.json` for project/allowlist
- Holds **one in-process `AgentSession` per active channel-peer** (or pools them)
- Translates external messages → AgentSession input events → captured assistant output
- Enforces allowlists at the adapter level (defense in depth - the in-process `permission-gate.ts` extension is the second line)

Channel adapters ship as **separate npm packages**: `@mypensieve/channel-telegram`, `@mypensieve/channel-discord`, etc. Operator installs only the channels they want.

### When to use RPC mode instead

`runRpcMode` is publicly exported (`packages/coding-agent/src/index.ts:301`), documented (`docs/sdk.md:1020-1073`, `docs/rpc.md`), and stable. It is suitable for:

- **Process isolation** - if a channel adapter must run in a sandboxed subprocess
- **Cross-language adapters** - if a channel daemon is written in Python or Go and needs to drive Pi
- **Untrusted environments** - extra defense in depth
- **Crash isolation** - if Pi crashes mid-session, the adapter daemon survives

For default MVP channel adapters, **prefer in-process `AgentSession`** (matches pi-mom's proven pattern, simpler error handling, no IPC serialization cost). RPC is the optional fallback.

---

## N5: PI AS FOUNDATION (LOCKED)

**Decision:** MyPensieve uses `@mariozechner/pi-coding-agent` as its runtime foundation. We embed it as a library, ship extensions, and write channel adapters that drive it via RPC. We do not fork, patch, or replace any part of Pi's core.

**Rationale:**
- Pi's existing capabilities cover ~70% of what MyPensieve needs
- Pi's extension API is sufficient for the remaining 30%
- Time to MVP shrinks dramatically
- We benefit from Pi's ongoing development (new providers, bug fixes, performance improvements)
- License (MIT) and ecosystem (npm) make this clean

**Risks accepted:**
- Pi is a single-maintainer project. Bus factor is real. Mitigation: pin versions, maintain a fork-ready posture (everything we add is in extensions, fork would be a fallback not a default).
- Pi is currently in an OSS Weekend refactor freeze until 2026-04-13 (verified from `/tmp/pi-mono/.github/oss-weekend.json`). Only 2 small commits since March 15 (announcement message + stream-retry bug fix); the refactor is on a private branch and will land around April 13. Plan: re-audit Pi after the freeze, before committing implementation work to specific APIs. Watch for changes to: `AgentSessionRuntime`, `createAgentSessionServices`, extension API surface, RPC protocol.
- Extension API surface may change. Mitigation: pin Pi to a specific version, adopt new versions deliberately.
- `runRpcMode` has no in-repo consumer (pi-mom uses in-process embedding, not RPC). Edge cases may be less battle-tested. Mitigation: write our own RPC smoke test in CI; default channel adapters to in-process embedding.

**Version pinning:** Pin exact versions in `package.json`:
```json
{
  "dependencies": {
    "@mariozechner/pi-coding-agent": "0.65.2",
    "@mariozechner/pi-ai": "...",
    "@mariozechner/pi-agent-core": "..."
  }
}
```

Bump deliberately, never automatically.

---

## N6: COUNCIL VIA HOST ORCHESTRATION (LOCKED)

**Question:** Pi's `subagent/` extension supports parallel and chain modes for sub-agents, but neither is true peer collaboration. Parallel mode has zero cross-visibility between tasks. Chain mode passes a single `{previous}` slot, not a growing transcript. The `handoff.ts` extension is one-at-a-time session replacement, not peer handoff. **Pi has no native multi-agent council support.**

**Decision:** MyPensieve implements council mode as **out-of-band orchestration in the host process**, calling `@mariozechner/pi-ai`'s `complete()` directly per agent turn. We do not use `AgentSession` for council members - it is too heavy (built around filesystem sessions, TUI wiring, extensions we do not need).

### Council orchestration loop

```
function deliberate(topic, context, agents=[researcher, critic, synthesizer]):
    transcript = []
    
    # Phase 1: Research
    researcher_msg = build_messages(
        system = load("workspace/agents/researcher/system-prompt.md"),
        user   = format_prompt(topic, context, transcript)
    )
    research = pi_ai.complete(
        model = resolve_tier_hint("standard"),
        messages = researcher_msg,
        tools = [web_fetch, web_search, memory_query]
    )
    transcript.append({phase: "research", agent: "researcher", content: research})
    
    # Phase 2: Analysis (each non-researcher agent in series)
    for agent in [orchestrator]:  # additional analysts
        msg = build_messages(
            system = load(f"workspace/agents/{agent}/system-prompt.md"),
            user   = format_prompt_with_transcript(topic, context, transcript)
        )
        analysis = pi_ai.complete(model=resolve_tier_hint(agent.tier_hint), messages=msg)
        transcript.append({phase: "analysis", agent: agent, content: analysis})
    
    # Phase 3: Critique
    critic_msg = build_messages(
        system = load("workspace/agents/critic/system-prompt.md"),
        user   = format_prompt_with_transcript(topic, context, transcript)
    )
    critique = pi_ai.complete(model=resolve_tier_hint("standard"), messages=critic_msg)
    transcript.append({phase: "critique", agent: "critic", content: critique})
    
    # Phase 4: Synthesis
    synth_msg = build_messages(
        system = load("workspace/agents/orchestrator/system-prompt.md"),
        user   = format_synthesis_prompt(topic, context, transcript)
    )
    synthesis = pi_ai.complete(model=resolve_tier_hint("deep"), messages=synth_msg)
    transcript.append({phase: "synthesis", agent: "orchestrator", content: synthesis})
    
    # Persist + return
    deliberation_id = save_to_research_dir(transcript)
    decision = extract_decision(synthesis)
    write_decision_to_active_project(decision, source=deliberation_id)
    
    return {
        recommendation: decision,
        transcript: transcript,
        deliberation_id: deliberation_id,
        cost: sum_costs(transcript)
    }
```

### Why this is better than `AgentSession` spawning

| Concern | AgentSession spawning | Host orchestration with `pi-ai` |
|---|---|---|
| Setup overhead per agent | Heavy (filesystem session, TUI wiring, extension loading) | Zero (just a function call) |
| Inter-agent visibility | Zero - sessions are isolated | Full - host owns the transcript |
| Turn order control | Implicit | Explicit |
| Persistence | Forced (Pi writes session JSONL) | Optional (we write what we want, where we want) |
| Tool use per agent | Always available | Only if we wrap the call in `createAgentSession` (selective) |
| Cost | Higher (full session for each turn) | Lower (one `complete()` per turn) |

For council members that need tools (e.g. Researcher needs web_fetch), wrap that one in `createAgentSession` with custom tools and pass the transcript as the initial message. Everyone else uses bare `complete()`.

### Council agents live in `~/.pi/agent/agents/`

This is the dual-use trick: putting council agents in Pi's agents directory means they are **simultaneously**:
- **Pi sub-agents** (invokable via the `subagent/` extension's chain or parallel modes for hierarchical use cases)
- **MyPensieve council members** (invokable via `mypensieve deliberate` for peer collaboration)

Same file, two invocation patterns.

Pi's agent format is markdown with YAML frontmatter (`name`, `description`, `tools`, `model`). MyPensieve adds extra frontmatter fields that Pi ignores:

```markdown
---
name: researcher
description: Facts-first evidence gatherer for council deliberations
model: claude-sonnet-4-6
tools: [web_fetch, web_search, memory_query]

# MyPensieve extensions (Pi ignores these)
mypensieve_tier_hint: standard
mypensieve_can_be_convened: true
mypensieve_can_be_default: false
mypensieve_token_budget: 20000
mypensieve_max_turns: 10
---

You are the Researcher, a member of MyPensieve's council of agents.
Your role is evidence-gathering...
```

The `model` field in Pi's frontmatter is used by the `subagent/` extension for chain/parallel mode. MyPensieve council mode ignores it and uses `mypensieve_tier_hint` → routing → resolved model instead.

---

## VERSION PINNING + UPSTREAM TRACKING

| Action | When |
|---|---|
| Pin exact Pi versions in `package.json` | Always |
| Re-audit Pi after OSS Weekend freeze ends | 2026-04-13 |
| Subscribe to Pi's Discord and GitHub releases | Continuous |
| Bump Pi version | Deliberately, with manual review of changelog |
| Run MyPensieve's full extension test suite against new Pi version | Before any bump |
| Maintain a fork-ready posture | Always - all our code is in extensions, fork is a fallback not a default |

---

## KEY FILE REFERENCES

These are the files anyone implementing MyPensieve should read first, in order:

1. `/tmp/pi-mono/README.md` - top-level orientation
2. **`https://mariozechner.at/posts/2025-11-30-pi-coding-agent/`** - design intent (read this BEFORE the code)
3. **`https://cognition.ai/blog/dont-build-multi-agents`** - the multi-agent school of thought
4. `/tmp/pi-mono/packages/coding-agent/src/index.ts` - public SDK surface
5. `/tmp/pi-mono/packages/coding-agent/src/core/sdk.ts` - how to embed (`createAgentSession`, `createAgentSessionRuntime`)
6. `/tmp/pi-mono/packages/coding-agent/src/core/agent-session.ts` (3059 lines) - the loop
7. `/tmp/pi-mono/packages/coding-agent/src/core/auth-storage.ts` - OAuth + credentials
8. `/tmp/pi-mono/packages/coding-agent/src/core/session-manager.ts` - JSONL trees
9. `/tmp/pi-mono/packages/coding-agent/src/core/skills.ts` - skills system
10. `/tmp/pi-mono/packages/coding-agent/src/core/extensions/types.ts` - extension API contract
11. `/tmp/pi-mono/packages/coding-agent/src/core/compaction/` - compaction
12. `/tmp/pi-mono/packages/coding-agent/src/config.ts` - all `~/.pi/agent/*` paths
13. `/tmp/pi-mono/packages/coding-agent/docs/sdk.md` (lines 1020-1073) - SDK documentation including `runRpcMode`
14. `/tmp/pi-mono/packages/coding-agent/docs/rpc.md` - RPC wire protocol
15. `/tmp/pi-mono/packages/coding-agent/docs/models.md` - provider configuration via `models.json` (OpenRouter, Ollama, Groq, Together, Fireworks all here)
16. `/tmp/pi-mono/packages/coding-agent/examples/extensions/` - ~80 working examples (especially `subagent/`, `handoff.ts`, `permission-gate.ts`, `dynamic-tools.ts`, `custom-provider-anthropic/`, `with-deps/`, `protected-paths.ts`, `plan-mode/`, `protected-paths.ts`)
17. `/tmp/pi-mono/packages/ai/src/providers/` - 10 provider implementations (anthropic, openai-completions, openai-responses, openai-codex-responses, google, google-vertex, google-gemini-cli, mistral, amazon-bedrock, azure-openai-responses, faux). NO openrouter.ts or ollama.ts - both are accessed via the openai-completions shim with custom baseUrl.
18. `/tmp/pi-mono/packages/ai/src/oauth.ts` and `/tmp/pi-mono/packages/ai/src/utils/oauth/anthropic.ts` - OAuth flow
19. `/tmp/pi-mono/packages/agent/src/agent-loop.ts` - the underlying loop primitive
20. `/tmp/pi-mono/packages/mom/src/agent.ts` - **the canonical channel adapter pattern**, in-process AgentSession embedding

---

## FIRST IMPLEMENTATION STEPS

When MyPensieve actually gets built, do these in order:

1. **Install Pi.** `npm i -g @mariozechner/pi-coding-agent@0.65.2`. Run `pi`. Poke around `~/.pi/agent/` to see real file layouts.
2. **Read the 14 reference files above.** Walk all 80 example extensions in `examples/extensions/`.
3. **Prototype the memory extension first.** Single `.ts` file dropped in `~/.pi/agent/extensions/` that listens on `TurnEndEvent` and appends one line to `~/.mypensieve/memory.jsonl`. Validates the extension model end-to-end in a day.
4. **Prototype the MCP client extension second.** This is the one real gap and the earliest risk. Use the `dynamic-tools.ts` example as the starting point.
5. **Then build the channel binding extension** - reads binding.json, enforces project routing.
6. **Then build the council orchestrator** as a slash command + standalone function calling `pi-ai.complete()` directly. Test with a simple two-agent deliberation first.
7. **Then build the channel adapters** - start with CLI (thin wrapper), then Telegram (modeled on `pi-mom`).
8. **Last:** the rest of the extensions (cost tracking, decision extractor, persona injector, permission gate).

---

## RELATIONSHIP TO PREVIOUSLY LOCKED DECISIONS

| # | Original lock | Status after Pi adoption |
|---|---|---|
| Name | MyPensieve | Unchanged |
| 1 | Hybrid JSONL+SQLite for distilled memory | Unchanged - this is our memory storage, not Pi's |
| 2 | Extractor schedule (raw live + session-end + nightly + manual) | Unchanged - hooked to Pi's `SessionShutdownEvent` and standalone cron |
| 3 | Channel-bound projects + filesystem registry | Unchanged - layered on Pi via channel adapters + extension |
| N1 | Embeddings via nomic-embed-text (optional) | Unchanged - Pi has no embedding code, this is our subsystem |
| N2 | Toolshed + bridge with tier_hint | **REVISED** - skills are Pi-native (`~/.pi/agent/skills/`). Bridge collapses to a permission-gate extension. Tier_hint is a thin function over `pi-ai`'s provider/model selection. See updated TOOLSHED-BRIDGE-ARCHITECTURE.md |
| N3 | Read-only config + secrets dir | **REVISED** - AI provider secrets live in Pi's `~/.pi/agent/auth.json`. Our `~/.mypensieve/.secrets/` is for non-AI secrets only. MyPensieve config at `~/.mypensieve/config.json` stays read-only at runtime. |
| N4 | Provider abstraction | **ABSORBED** - we use `pi-ai` directly. PROVIDERS.md shrinks to documenting our tier_hint routing layer. |
| Agents/Council | Multi-agent runtime | **REVISED** - solo mode is just Pi running our extensions. Council mode is host-orchestrated via `pi-ai` direct calls (N6). Council agents live in `~/.pi/agent/agents/` with extended frontmatter. See updated MULTI-AGENT-RUNTIME.md |
| **N5** | **Pi as foundation** | **NEW LOCK** - MyPensieve = Pi SDK embed + extension bundle + channel adapters. No fork. |
| **N6** | **Council via host orchestration** | **NEW LOCK** - council uses `pi-ai.complete()` directly, not `AgentSession`. Host owns the shared transcript. |

---

## SUMMARY OF LOCKED CHOICES

| Aspect | Choice |
|---|---|
| Foundation | `@mariozechner/pi-coding-agent` (and pi-mono ecosystem) |
| Integration model | SDK embed + extension bundle + **in-process channel adapters** (not RPC by default) |
| Fork/patch policy | Never. Pin versions. Track upstream. |
| Where Pi state lives | `~/.pi/agent/` |
| Where MyPensieve state lives | `~/.mypensieve/` |
| Language/runtime | TypeScript, ESM, Node ≥20 (locked by Pi) |
| Council orchestration | Host process, `pi-ai.complete()` direct, shared in-memory transcript, AutoGen GroupChat semantics. See MULTI-AGENT-RUNTIME.md. |
| Council agent location | `~/.pi/agent/agents/<name>.md` (dual-use as Pi sub-agents and council members) |
| Skills location | `~/.pi/agent/skills/<name>/SKILL.md` (Pi-native) |
| AI credentials | Pi's `AuthStorage` (`~/.pi/agent/auth.json`) |
| Non-AI credentials | `~/.mypensieve/.secrets/` (Telegram bot token, etc.) |
| MCP client | New Pi extension (the one real gap) |
| Memory | New Pi extension reading from Pi's session JSONL via lifecycle hooks |
| Channel adapters | **In-process daemons** holding one `AgentSession` per peer, modeled on `pi-mom`. RPC mode (`runRpcMode`) is the optional process-isolation alternative. |
| Provider config | OpenRouter, Ollama (local), Groq, Together, Fireworks all configurable via `~/.pi/agent/models.json` with **zero extension code** - they go through Pi's `openai-completions` shim. See PROVIDERS.md. |

---

## OPEN QUESTIONS (NOT BLOCKING MVP, BUT NOTE THEM)

1. **Pi version stability** - re-audit after OSS Weekend freeze ends 2026-04-13 (5 days from now). Watch for changes to `AgentSessionRuntime`, `createAgentSessionServices`, extension API surface, RPC protocol.
2. **Extension dependencies** - the `with-deps` example shows extensions can have their own `package.json`. MyPensieve's bundle will need its own deps (SQLite driver, MCP SDK, etc.). Verify dependency resolution works for the bundled extension dir.
3. **Bun binary compatibility** - if a user installs Pi as the Bun single-binary, do extensions still load? Need to test.
4. **Multi-tenant Pi** - if multiple users on the same machine each have their own `~/.pi/agent/`, MyPensieve should respect that. No shared state between user accounts.
5. ~~Pi RPC mode stability~~ - **Verified.** `runRpcMode` is publicly exported, documented in `docs/sdk.md` and `docs/rpc.md`, untouched by recent commits, accessible via `pi --mode rpc --no-session`. Safe to use, BUT no in-repo consumer (pi-mom uses in-process), so write our own RPC smoke test in CI before building anything on it.
6. **Ollama Cloud `/v1` compat** - Pi's openai-completions shim assumes `/v1` paths. Hosted Ollama at `https://ollama.com` uses native `/api/chat` and `/api/tags`. **Curl test required before MVP**: does `https://ollama.com/v1/chat/completions` work as an OpenAI-compatible endpoint? If yes, hosted Ollama "just works" via models.json. If no, write a thin custom-provider extension that translates `/v1` calls to `/api/chat`.

---

## Re-audit history

This doc is pinned to a specific Pi version. When Pi releases new versions, the `PI-REAUDIT-CHECKLIST.md` + `scripts/pi-reaudit.sh` workflow runs against the new code and the outcome is recorded here as a one-paragraph note. Do not silent-drift.

| Date | Pi version | Commit | Outcome bucket | Action taken | Notes |
|---|---|---|---|---|---|
| 2026-04-09 | 0.66.1 | `3b7448d` | Baseline | None | Captured during freeze (active until 2026-04-13). Surface watch list verified, all required symbols (`AgentSession`, `runRpcMode`, `formatSkillsForPrompt`, `AuthStorage`) present. `AgentSessionRuntime` and `createAgentSessionServices` not yet present (expected - refactor lands post-freeze). Baseline report at `scripts/pi-reaudit-report-2026-04-09.md`. |

---

*Implementation note: this doc is the contract. When MyPensieve gets built, anything that does not match this doc is either a bug or a new locked decision documented here.*
