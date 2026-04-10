# MyPensieve - Toolshed + Bridge Architecture
> Status: LOCKED | Created: 2026-04-08 | Amended 2026-04-09 (N10 gateway)
> **Read PI-FOUNDATION.md first, then META-SKILL-GATEWAY.md.**
> Companion to MEMORY-ARCHITECTURE.md, PROVIDERS.md, MULTI-AGENT-RUNTIME.md, SKILLS-MCP-SHORTLIST.md.
> This doc covers HOW MyPensieve handles skills and MCPs on top of Pi.

> **N10 amendment (2026-04-09):** The "bridge" is no longer just a permission-gate hook. It is now the **meta-skill gateway** - the agent sees 8 typed verbs instead of raw skills/MCPs. The four sub-extensions described below (permission-gate, mcp-client, tier-resolver, audit) all live BEHIND the gateway and are invoked deterministically by the verb routers. The agent never calls them directly. **Read META-SKILL-GATEWAY.md for the full gateway design.** Sections of this doc that describe the agent calling skills/MCPs directly are superseded by N10.

**Important:** Pi (the foundation) **already implements the skills system** that MyPensieve was going to build. Skills go in `~/.pi/agent/skills/<name>/SKILL.md` (Pi-native). Pi's `formatSkillsForPrompt` does the lazy catalog injection. MyPensieve's contributions are: (a) the **MCP client** (the one real gap in Pi), (b) **channel-aware allowlists** as a `permission-gate.ts`-style extension, (c) the **tier_hint resolution** layer, (d) the **audit log** for cost tracking, **and (e) the meta-skill gateway (N10) that wraps all four behind 8 typed verbs**. The "bridge" is no longer a custom invocation runtime - it is the verb gateway plus a thin permission-and-routing layer underneath.

---

## WHY THIS DOC EXISTS

A general-purpose autonomous agent OS will accumulate dozens of skills and MCPs over time. The naive approach - load every skill description and every MCP tool definition into the agent's context at every session - does not scale.

**Pi already solves the skills part.** Pi implements the Agent Skills spec: markdown files with YAML frontmatter, loaded from `~/.pi/agent/skills/`, lazy catalog injection via `formatSkillsForPrompt`. The base context cost stays low because only the catalog (one-line descriptions) is in the system prompt; the actual skill body loads only when invoked.

What Pi does NOT solve and MyPensieve adds:

1. **MCP client support** - Pi has no MCP client. MyPensieve adds one as an extension that connects to MCP servers and registers their tools dynamically.
2. **Channel-aware allowlists** - Pi has tools and skills but no concept of "this Telegram channel can only invoke a subset". MyPensieve adds a permission-gate extension that intersects per-skill allowlists with per-channel binding allowlists.
3. **Tier_hint resolution** - Pi providers are addressed by `provider/model` strings. MyPensieve adds the `tier_hint` abstraction so skills declare capability needs, not specific models.
4. **Audit log** - Pi has lifecycle events but no built-in audit log. MyPensieve subscribes to those events and writes structured audit records for cost tracking, security review, and Loop B routing learning.

This is the locked answer to architecture decision **N2** (skill model), revised after the Pi research.

---

## THE TOOLSHED (PI-NATIVE LOCATIONS)

Skills live in **Pi's native directory** at `~/.pi/agent/skills/<name>/`. MCPs (which Pi does not natively support) live in MyPensieve's namespace at `~/.mypensieve/mcps/<name>/`.

```
~/.pi/agent/skills/                   # PI OWNS THIS
├── morning-briefing/
│   └── SKILL.md                      # markdown with YAML frontmatter, body is the skill prompt
├── medium-draft/
│   └── SKILL.md
├── research-target/
│   └── SKILL.md
└── ... (any number of skills - Pi loads them automatically)

~/.mypensieve/mcps/                   # MYPENSIEVE OWNS THIS
├── _catalog.md                       # auto-generated MCP index
├── telegram/
│   └── manifest.json                 # how to spawn, what tools it provides, when to load
├── github/
│   └── manifest.json
├── playwright/
│   └── manifest.json
└── ... (any number of MCPs)
```

**Note:** Pi's skills format is a single `SKILL.md` per skill folder, not three separate files. The frontmatter has the metadata, the markdown body is the prompt. Pi's `formatSkillsForPrompt` loads the catalog (just frontmatter) into the system prompt and makes the body lazy-loaded via skill invocation.

There is no need for a separate `_catalog.md` for skills - Pi generates it on the fly from frontmatter via `formatSkillsForPrompt`. We **delete** the skill-catalog and mcp-catalog meta-skill concept from the original design - Pi already does this work.

### Skill anatomy (Pi-native format)

Each skill is a single `SKILL.md` file in `~/.pi/agent/skills/<name>/`. The frontmatter has metadata; the markdown body is the prompt. **MyPensieve adds extra frontmatter fields** that Pi ignores but MyPensieve's permission-gate and audit extensions read.

```markdown
---
# Pi-native frontmatter (from the Agent Skills spec)
name: medium-draft
description: |
  Drafts a Medium post in the operator's voice. Input: topic, style, length.
  Output: full draft with title, body, and a slot for affiliate links.
  Use when the operator asks to write, draft, or prepare a Medium article.
disable-model-invocation: false

# MyPensieve extensions (Pi ignores these; our extensions read them)
mypensieve_category: content
mypensieve_tier_hint: standard
mypensieve_schedule: "cron:0 9 */3 * *"
mypensieve_allowed_channels: [cli, telegram]
mypensieve_denied_channels: []
mypensieve_required_mcps: [filesystem]
mypensieve_optional_mcps: [github]
mypensieve_max_runtime_sec: 120
mypensieve_token_budget: 4000
mypensieve_writes_decisions: true
mypensieve_reads_memory: true
---

# The skill prompt (markdown body)

You are tasked with drafting a Medium post in the operator's voice...

(Full prompt body goes here. Pi's `formatSkillsForPrompt` keeps this body lazy
 - it only enters context when the skill is invoked.)
```

### Field semantics

| Field | Used by | Purpose |
|---|---|---|
| `name` | Pi | Unique identifier |
| `description` | Pi | The catalog description loaded into the system prompt |
| `disable-model-invocation` | Pi | If true, only invokable via slash command, not by the model |
| `mypensieve_category` | MyPensieve | For grouping in audit/cost reports |
| `mypensieve_tier_hint` | MyPensieve | Capability class for the model that runs this skill. Resolved via routing (see PROVIDERS.md). |
| `mypensieve_schedule` | MyPensieve | Optional cron expression for scheduled invocation |
| `mypensieve_allowed_channels` / `mypensieve_denied_channels` | MyPensieve permission-gate extension | Channel-level allowlist enforcement |
| `mypensieve_required_mcps` / `mypensieve_optional_mcps` | MyPensieve mcp-client extension | Pre-spawn required MCPs before invocation |
| `mypensieve_max_runtime_sec` | MyPensieve | Hard runtime cap |
| `mypensieve_token_budget` | MyPensieve | Hard token cap for this skill's invocation |
| `mypensieve_writes_decisions` | MyPensieve decision-extractor | Hint that this skill produces decisions |
| `mypensieve_reads_memory` | MyPensieve memory injector | Hint that this skill should be given memory context |

This dual-format approach means **a MyPensieve skill is also a valid Pi skill**. Anyone running just Pi (without MyPensieve) can use the skill - they just lose the channel allowlists, MCP integration, and tier_hint routing. The skill still works.

### MCP anatomy

Each MCP is a folder containing exactly one file:

#### `manifest.json`

```json
{
  "schema_version": 1,
  "name": "github",
  "description": "GitHub API access: read/write issues, PRs, comments, repos",
  "spawn": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env_secrets": ["github_pat"]
  },
  "tools_count": 12,
  "estimated_tool_tokens": 800,
  "allowed_channels": ["cli"],
  "denied_channels": ["telegram", "discord"],
  "default_for_channels": [],
  "sandbox": {
    "allowed_domains": ["api.github.com"],
    "allowed_paths": [],
    "network": true
  }
}
```

The `default_for_channels` field is important: any channel listed there will have this MCP **pre-spawned at session start**. Anything else has to be explicitly enabled by the agent via `enable_mcp(name)`.

---

## SKILL DISCOVERY: PI'S `formatSkillsForPrompt`

Pi already implements lazy skill discovery via `formatSkillsForPrompt` (in `/tmp/pi-mono/packages/coding-agent/src/core/skills.ts`). At session start:

1. Pi walks `~/.pi/agent/skills/*/SKILL.md` and `./.pi/skills/*/SKILL.md`
2. Pi extracts the frontmatter `name` + `description` from each
3. Pi formats them into a compact list and prepends to the system prompt
4. The full skill body (markdown after frontmatter) stays on disk
5. When the model invokes a skill, Pi loads that one body and provides it

**This is exactly what we wanted from the meta-skill catalog pattern.** We do not need to build it - delete the `skill-catalog` and `mcp-catalog` meta-skills from the original design. They are not needed.

What Pi loads into the system prompt at session start (example):

```
Available skills:
  - track-pr-comments: Polls configured GitHub PRs and reports new comments...
  - track-bounty-status: Checks status of configured bug bounty submissions...
  - medium-draft: Drafts a Medium post in the operator's voice...
  - research-target: Reconnaissance research on a bug bounty target...
  - weekly-review: Synthesizes the week's decisions and progress...
```

This is ~50-200 tokens per skill in the catalog form. With 75 skills that is ~7-15k tokens of base context (still much better than the 25k naive approach), and only the description loads - the body stays disk-resident.

**MyPensieve does NOT add a separate catalog or meta-skill.** Pi already does this work. Our skills go in Pi's skills dir and Pi handles discovery.

---

## THE BRIDGE COLLAPSES - PI ALREADY HAS THE TOOL SURFACE

The original design specified two custom bridge tools (`invoke_skill`, `enable_mcp`) that the agent would call. **Pi already provides skill invocation natively** via its skill discovery system - the agent invokes a skill the same way it invokes any tool, and Pi handles the loading of the body.

So the "bridge" is no longer a runtime layer with its own tools. It is **a set of Pi extensions** that hook into Pi's existing tool/skill lifecycle:

| MyPensieve extension | What it does | Pi hook |
|---|---|---|
| `permission-gate.ts` | Intersects per-skill `mypensieve_allowed_channels` with the current channel binding. Denies the call if not allowed. Same for MCPs. | `BeforeToolCallEvent` (or equivalent in Pi's extension API) |
| `mcp-client.ts` | Connects to configured MCP servers, registers their tools dynamically as Pi tools | `defineTool` registration via `dynamic-tools.ts` pattern |
| `tier-hint-resolver.ts` | When Pi is about to call a model for a skill, intercepts the request and rewrites the model based on `mypensieve_tier_hint` → routing → resolved provider/model | `BeforeProviderRequestEvent` |
| `audit.ts` | Logs every skill invocation, MCP enable, provider call to `~/.mypensieve/logs/audit/<date>.jsonl` | `BeforeProviderRequestEvent` + `TurnEndEvent` |

**There are no MyPensieve-specific bridge tools the agent calls.** The agent just uses Pi's tools and skills as it normally would. MyPensieve's enforcement happens in extension hooks, transparent to the model.

This is much simpler than the original design. Less code, less mental overhead, no new tool types for the model to learn.

---

## SKILL INVOCATION LIFECYCLE

```
1. Agent decides it needs a skill
   ├── If it knows the name: skip to step 4
   └── If it doesn't: continue to step 2

2. Agent: invoke_skill("skill-catalog")
   └── Optionally with args: invoke_skill("skill-catalog", {category: "content"})

3. Bridge:
   ├── Validate: agent is allowed to invoke skill-catalog from this channel? ✓
   ├── Load workspace/skills/skill-catalog/prompt.md
   ├── Run prompt (returns _catalog.md content, possibly filtered)
   ├── Log invocation to logs/audit/
   └── Return catalog text to agent (~5k tok for ~75 skills)

4. Agent reads catalog, picks a skill, calls:
   invoke_skill("medium-draft", {topic: "...", length: 600})

5. Bridge:
   ├── Look up workspace/skills/medium-draft/manifest.json
   ├── Check allowed_channels: current channel allowed? ✓
   ├── Check denied_channels: current channel not denied? ✓
   ├── Check required_mcps: are filesystem MCPs active? ✓
   ├── Resolve tier_hint from manifest (standard):
   │     ├── Check overrides for "skill:medium-draft" → none
   │     ├── Look up routing["standard"] → "claude/sonnet-4.6"
   │     ├── Look up provider "claude" → AnthropicProvider with OAuth
   │     └── Selected: claude/sonnet-4.6
   ├── Apply token_budget from manifest (4000)
   ├── Apply max_runtime_sec from manifest (120)
   ├── Load workspace/skills/medium-draft/prompt.md
   ├── Run prompt against the selected provider/model with operator's args
   ├── Capture result, write execution record to logs/audit/
   ├── If skill has writes_decisions: true, also write to projects/<active>/decisions.jsonl
   └── Return result to agent

6. Agent: receives result, continues
```

The tier_hint resolution happens **inside the bridge** at invocation time. The skill code knows nothing about Anthropic, Claude, or any specific provider. The same skill running on a different user's install might resolve to `ollama/llama3.1:70b` or `openrouter/google/gemini-2.5-flash`. This is the decoupling principle.

### Key invariants

- **The agent never reads `prompt.md` directly.** Only the bridge does.
- **The agent never reads `manifest.json`.** Only the bridge does.
- **The agent only ever sees:**
  - Its 2 bridge tools
  - MCP tools that are currently active for this session
  - The output of `invoke_skill()` calls (catalog or skill results)

This isolation is the security model.

---

## MCP ENABLE LIFECYCLE

```
1. Agent realizes it needs an MCP that is not active
2. Agent: invoke_skill("mcp-catalog")
   └── Bridge returns mcps/_catalog.md content (~2k tok)
3. Agent picks "github", calls enable_mcp("github")
4. Bridge:
   ├── Look up workspace/mcps/github/manifest.json
   ├── Check allowed_channels: current channel allowed? ✓
   ├── Check denied_channels: not denied? ✓
   ├── Resolve env_secrets: read .secrets/github_pat
   ├── Build sandboxed env: only allowed_domains, allowed_paths
   ├── Spawn MCP process with restricted env
   ├── Wait for MCP ready signal (timeout 10s)
   ├── Discover MCP's tools (via MCP protocol handshake)
   ├── Register tools into agent's context for the rest of session
   ├── Log activation to logs/audit/
   └── Return success + tool count to agent
5. MCP tools now appear in agent's context until session ends
6. On session end: bridge sends shutdown signal to MCP, kills if no response in 5s
```

### Sandboxing rules

Every MCP process is spawned with:

- **Restricted environment variables.** Only the secrets declared in `env_secrets`. No host env passed through.
- **Network allowlist.** If `network: true`, only the domains in `allowed_domains` are reachable. Enforced via local DNS interception or proxy.
- **Filesystem allowlist.** Only paths in `allowed_paths` are readable/writable. Everything else is invisible.
- **Process group isolation.** MCP runs in its own process group; killable as a unit at session end.
- **Resource limits.** CPU and memory caps via cgroups (Linux) or equivalent.

---

## CHANNEL-ALLOWLIST SECURITY MODEL

The bridge is the chokepoint. Every skill invocation and MCP enable call goes through it. The bridge enforces:

| Control | What it blocks |
|---|---|
| **Channel allowlist per skill** (manifest.json `allowed_channels`) | A Telegram channel cannot invoke `git-push` skill. CLI from operator's host can. |
| **Channel allowlist per MCP** (manifest.json `allowed_channels`) | A Telegram channel cannot enable `playwright` MCP (no browser automation from chat). |
| **Channel binding allowlist** (channels/<type>/<id>/binding.json `allowed_skills` and `allowed_mcps`) | Per-channel additional restrictions on top of per-skill defaults. The intersection of skill allowlist + channel allowlist is enforced. |
| **Token budget per skill** (manifest.json `token_budget`) | Runaway skill capped at manifest's value |
| **Runtime budget per skill** (manifest.json `max_runtime_sec`) | Hung skills killed |
| **Required MCP declaration** (manifest.json `required_mcps`) | Skill cannot run if its required MCPs cannot be enabled in the current channel |
| **Audit log of every invocation** | Bridge writes one line per call to `logs/audit/<date>.jsonl` - skill name, channel, peer, args hash, result status, tokens used, runtime, allow/deny reason if rejected |
| **No direct file or network access from skill bodies** | Skills are markdown prompts. They produce text and tool calls. The bridge translates intent into bridge-mediated calls. There is no `subprocess.run()` from inside a skill |
| **MCP process sandboxing** (see above) | Spawned with restricted env, allowlisted domains, allowlisted paths. Killed at session end |

### Why this matters

A Telegram bot is reachable by anyone with the link. We cannot trust messages arriving on it. Without the bridge, a hostile message could trick the agent into invoking a destructive skill or enabling a powerful MCP. With the bridge, the worst a hostile Telegram message can do is invoke a skill explicitly allowed for the Telegram channel - which is a small, vetted set.

---

## AUDIT LOG SCHEMA

Every bridge call is logged. The audit log lives at `~/.mypensieve/logs/audit/<date>.jsonl`. One line per call:

```json
{
  "timestamp": "2026-04-08T22:15:32.847+05:30",
  "session_id": "2026-04-08-cli-001",
  "channel_type": "cli",
  "channel_id": "home_code_foo",
  "peer_id": null,
  "call_type": "invoke_skill",
  "target": "medium-draft",
  "args_hash": "sha256:abc123...",
  "decision": "allowed",
  "reason": null,
  "model_used": "sonnet",
  "tokens_in": 1247,
  "tokens_out": 891,
  "runtime_ms": 4231,
  "result_status": "success"
}
```

For denied calls:

```json
{
  "timestamp": "...",
  "call_type": "enable_mcp",
  "target": "playwright",
  "decision": "denied",
  "reason": "channel_not_in_allowed_list",
  "channel_type": "telegram",
  "channel_id": "chat-12345"
}
```

The audit log feeds:
- Cost tracking (tokens × tier price)
- Skill performance stats (Loop B routing data)
- Security review (which channels are trying to do what)
- Debugging (why did skill X fail at 22:15?)

---

## TOKEN MATH (THE WHOLE POINT)

### Naive approach (no bridge, all tools always loaded)

| Item | Tokens |
|---|---|
| 75 skill descriptions × ~200 tok each | ~15,000 |
| 12 MCP tool sets × ~800 tok avg | ~9,600 |
| **Per-session base context, every session** | **~25,000** |
| Across 10 sessions/day | 250k tok/day on tool definitions |

### MyPensieve approach (bridge + lazy load)

| Scenario | Tokens |
|---|---|
| Base bridge context (2 tools) | ~300 |
| Channel-default MCPs (typically 2-3) | ~2-3k |
| **Per-session base context, every session** | **~3k** |
| Session with cron-triggered skill (knows the name) | ~3k + ~800 (skill body) = **~3.8k** |
| Session where agent must discover (catalog query + 1 skill) | ~3k + ~5k (catalog) + ~800 (skill) = **~8.8k** |
| Session that needs an extra MCP enabled | ~3k + ~800 (mcp-catalog) + ~800 (MCP tools) + ~800 (skill) = **~5.4k** |

**Savings: ~80-95% of base context vs. naive approach.**

The catalog cost is paid only when needed. Most sessions will not need it because:
- Cron-triggered sessions know the skill name (no discovery)
- Cross-session handoff can include "skills used recently" in L1, so the agent already knows common names
- Orchestrator can hint likely skills based on session intent
- Once the agent invokes the catalog once in a session, it has the full list in context for the rest of the session

This is the difference between "MyPensieve is too expensive to run" and "MyPensieve fits in any plan."

---

## REINDEX OPERATIONS

The toolshed has its own reindex pipeline, parallel to memory's reindex.

| Command | What it does |
|---|---|
| `mypensieve reindex skills` | Walks `workspace/skills/*/SKILL.md`, regenerates `workspace/skills/_catalog.md` |
| `mypensieve reindex mcps` | Walks `workspace/mcps/*/manifest.json`, regenerates `workspace/mcps/_catalog.md` |
| `mypensieve reindex all` | Runs both, plus the memory reindex |

Reindex runs:
- Automatically after `mypensieve skill add <name>` or `mypensieve skill edit <name>`
- Automatically after `mypensieve mcp register <name>`
- Manually via the commands above
- Nightly as part of the cron pass

The reindex is idempotent and cheap - it just walks files and regenerates a single catalog file.

---

## RELATIONSHIP TO MEMORY ARCHITECTURE

The toolshed and memory subsystems are linked but independent:

| Connection | How it works |
|---|---|
| **Audit log feeds Loop B** | Bridge writes execution stats to `logs/audit/`. Nightly synthesizer extracts skill performance facts (`(skill, success_rate, model, valid_from, valid_to)`) into the bitemporal facts table. |
| **Skills can write decisions** | If a skill has `writes_decisions: true` in its manifest, the bridge captures its output as a decision record and writes it to the active project's `decisions.jsonl`. |
| **Skills can read memory** | If a skill has `reads_memory: true`, the bridge injects the current project's `state.md` into the skill's prompt as context. |
| **Skill prompt evolution (Loop A)** | When the operator gives feedback on a skill's output, the extractor logs it as a persona delta linked to that skill. The nightly synthesizer can propose prompt changes (versioned in the skill's folder) that the operator approves. |
| **Channel binding governs both** | The same `channels/<type>/<id>/binding.json` file controls memory project routing AND skill/MCP allowlists. One concept, two effects. |

The bridge does **not** know about memory internals. The memory system does **not** know about bridge internals. They communicate only through the audit log and the manifest declarations.

---

## SUMMARY OF LOCKED CHOICES (REVISED AFTER PI RESEARCH)

| Aspect | Choice |
|---|---|
| **Skill format** | **Pi-native single `SKILL.md`** in `~/.pi/agent/skills/<name>/`. Frontmatter has Pi-native fields (`name`, `description`, `disable-model-invocation`) plus MyPensieve-extension fields (`mypensieve_tier_hint`, `mypensieve_allowed_channels`, etc.). Markdown body is the prompt. |
| **MCP format** | `manifest.json` in `~/.mypensieve/mcps/<name>/` (Pi has no MCP support, this is our addition) |
| **Skill discovery** | **Pi's `formatSkillsForPrompt`** - native lazy catalog injection |
| **Skill model binding** | None - skills declare `mypensieve_tier_hint`, runtime routing resolves to provider/model. See PROVIDERS.md. |
| **Bridge surface** | **No custom tools.** MyPensieve extensions hook Pi's existing tool/skill/provider lifecycle events. |
| **Channel enforcement** | `permission-gate.ts` extension intersects per-skill allowlist with channel binding allowlist on `BeforeToolCallEvent` |
| **MCP integration** | `mcp-client.ts` extension connects to MCP servers and registers their tools via Pi's dynamic-tool registration |
| **Tier_hint resolution** | `tier-hint-resolver.ts` extension rewrites model selection on `BeforeProviderRequestEvent` |
| **Sandboxing** | MCP processes spawned with restricted env, allowlisted domains and paths, killed at session end - enforced by `mcp-client.ts` |
| **Audit** | `audit.ts` extension logs every provider call + tool call to `~/.mypensieve/logs/audit/<date>.jsonl` |
| **Token savings** | Inherits Pi's lazy skill loading - ~80-95% savings vs. naive "all tools loaded" approach |

---

## OPEN QUESTIONS (NOT BLOCKING)

These do not block MVP but should be answered before scaling past ~50 skills:

1. **Skill versioning** - When a skill's prompt evolves (Loop A), where do old versions live? Suggested: `workspace/skills/<name>/history/<version>.md`. Operator can roll back via `mypensieve skill rollback <name> <version>`.
2. **Skill dependencies** - Can a skill invoke another skill? (Yes, via the same bridge - skills can call `invoke_skill` recursively, with depth cap.) Should there be explicit dependency declarations in manifest.json?
3. **MCP hot-reload** - If an MCP's manifest changes mid-session, do we restart the spawned process? Suggested: no - manifest changes apply to next session. Live restart is out of scope.
4. **Skill marketplace / sharing** - How would users share skills with each other? (This is a v2 concern. For now, skills are local-only, copied via filesystem.)

---

*Implementation note: when MyPensieve gets built, this doc is the contract. Any deviation must be a new locked decision documented here, not silent drift.*
