# MyPensieve

[![npm version](https://img.shields.io/npm/v/mypensieve)](https://www.npmjs.com/package/mypensieve)
[![npm downloads](https://img.shields.io/npm/dm/mypensieve)](https://www.npmjs.com/package/mypensieve)
[![CI](https://github.com/HunterSreeni/MyPensieve/actions/workflows/ci.yml/badge.svg)](https://github.com/HunterSreeni/MyPensieve/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/HunterSreeni/MyPensieve)](https://github.com/HunterSreeni/MyPensieve/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A general-purpose, self-evolving autonomous agent OS with persistent memory across sessions.

Built on top of [Pi](https://github.com/badlogic/pi-mono) (`@mariozechner/pi-coding-agent`) by [Mario Zechner](https://github.com/badlogic).

> The name is a Harry Potter reference - the Pensieve is a magical basin where you store extracted memories and revisit them later. That is exactly what this OS does.

---

## What it does

- **Persistent memory** - decisions, threads, and persona insights survive across sessions. Ask "what did we decide about X last week?" and get an answer.
- **8-verb gateway** - the agent sees 8 typed verbs (`recall`, `research`, `ingest`, `monitor`, `journal`, `produce`, `dispatch`, `notify`), never raw tools. Security by architecture.
- **Operator-in-the-loop confirms** - destructive `dispatch` actions (git, PRs, deploys) are gated by inline Approve/Deny prompts on both CLI and Telegram. Agent-controlled bypass is not possible.
- **Multi-channel** - CLI and Telegram with the full 8-verb gateway wired on both. Same memory, different interfaces.
- **Council mode** - convene multiple AI agents with different models to debate a decision. Researcher gathers facts, Critic challenges assumptions, Devil's Advocate argues the opposite.
- **Per-agent model assignment** - assign any LLM from any provider to any agent. Mix Ollama, Anthropic, OpenAI, or OpenRouter freely.
- **Persona loadouts** - maintain multiple switchable agent personas (`work`, `creative`, `default`) and flip between them with `mypensieve persona switch <name>`.
- **Nightly memory pipeline** - sessions → extractor (any of 4 providers) → decisions/threads/persona-deltas → synthesizer dedup/aggregation. All automatic via in-process echoes.
- **Daily journal** - structured EOD ritual that captures wins, blockers, mood, energy. Queryable trends over time.
- **Hybrid security guardrails** - read deny-list + write allow-list enforced via Pi's `beforeToolCall` hook and verb-level path validation.

---

## Status: v0.3.0

**MyPensieve is in active development.** v0.3.0 ships the autonomous operations layer - scheduled echoes, operator-in-the-loop confirmations, persona loadouts, multi-provider memory extraction, and full gateway integration into the Telegram channel.

```bash
npm install -g mypensieve
mypensieve init
mypensieve start
```

### For developers / contributors

```bash
git clone https://github.com/HunterSreeni/MyPensieve.git
cd MyPensieve
npm install
npm test          # 579 tests
npm run build     # compile TypeScript
node dist/cli/index.js --help
```

---

## What's new in v0.3.0

### Autonomous operations
- **Echoes wired** - daily-log reminders, nightly memory extraction, automated backups all fire on their configured crons via an in-process scheduler. No system cron needed.
- **Synthesizer** - after each nightly extraction, the synthesizer de-duplicates decisions and aggregates persona deltas. Report-only by default; `mypensieve synthesize --apply` commits the canonicalization.

### Operator-in-the-loop safety
- **Dispatch confirm enforcement** - destructive verbs (currently `dispatch`) must be approved by the operator before execution. CLI prompts interactively via `@clack/prompts`; Telegram sends inline Approve/Deny buttons with a 60s auto-deny timeout.
- **LLM self-bypass prevented** - the `confirm:false` argument an agent might set is ignored by the dispatcher. The provider decides, not the LLM.
- **Group-chat hijack defense** - Telegram confirmation tabs are bound to the requesting peer; other allowed peers in a group cannot tap through another peer's prompt.
- **Verb-level write-path validation** - `produce.output_path` is checked against the filesystem allow-list before the skill runs, complementing Pi's `beforeToolCall` hook.

### Persona loadouts
- **Multi-persona support** - store unlimited agent identities under `~/.mypensieve/loadouts/<name>/` and switch between them at will.
- **CLI** - `mypensieve persona list | switch <name> | create <name> | show [<name>] | delete <name>`.
- **Migration** - existing single-persona installs seed a `default` loadout automatically.

### Memory extraction, multi-provider
- **Four providers wired** - Ollama, Anthropic, OpenAI, OpenRouter all work as extractor backends. The factory resolves the API key once per run (fails fast on missing key).
- **Channel-aware attribution** - each session's channel is tagged via `~/.mypensieve/state/session-meta/<sessionId>.<hash>.json` and surfaced in the per-channel binding.
- **Per-channel checkpoints** - CLI and Telegram extraction advance independently via `.extractor-anchors.json`. Legacy single-anchor path kept for back-compat.

### Gateway in Telegram
- The 8-verb gateway now loads as a session-scoped extension inside every Telegram peer session.
- Each peer gets its own `ConfirmProvider` + `TelegramConfirmRegistry` - scoped, isolated, torn down on `/reset` and inactivity reap.

### Audit & observability
- Operator-denied verb calls are logged as `audit.fail` with `operator_denied: <reason>` so audit log readers can tell "executed successfully" from "operator refused".

### Stats
- **579 tests** across 51 test files (was 525 at v0.2.0)
- 54 new tests added during v0.3.0 development
- 3-agent code review pass + focused fix-review pass; 17 distinct issues found and fixed before release

---

## Architecture overview

```
Operator
  |
  +--- CLI channel --------+
  |                         |
  +--- Telegram channel ----+---> 8-verb Gateway (+ ConfirmProvider)
                            |            |
                            |    +-------+--------+-------+-------+-------+-------+--------+-------+
                            |    |recall |research|ingest |monitor|journal|produce|dispatch|notify |
                            |    +-------+--------+-------+-------+-------+-------+--------+-------+
                            |            |
                            |    Skills + MCPs + verb-level guardrails
                            |            |
                            |    Filesystem tool-guard (beforeToolCall)
                            |            |
                            v            v
                    Memory Layers
                    L1: Decisions (JSONL + SQLite)
                    L2: Threads   (JSONL + SQLite)
                    L3: Persona deltas + loadouts
                    L4: Semantic  (optional, embeddings)
                    L5: Raw Pi sessions (JSONL)
                            |
                    Scheduled Echoes (in-process cron)
                    - daily-log reminder
                    - extractor (multi-provider) + synthesizer
                    - backup / verify / prune
```

### The 8 verbs

The agent never sees raw skill or MCP names. It interacts through 8 typed verbs:

| Verb | Purpose | Destructive? |
|------|---------|-------------|
| `recall` | Query persistent memory | no |
| `research` | Web search + synthesize with citations | no |
| `ingest` | Convert files/URLs to structured text | no |
| `monitor` | Check for changes (CVEs, packages, GitHub) | no |
| `journal` | Daily log - write, read, trends, review | local write |
| `produce` | Create content (blog, image, video, audio) | local write + guardrail-checked |
| `dispatch` | External state changes (git, PRs, deploys) | **YES - requires operator confirm** |
| `notify` | Send messages to operator | no |

### Scheduled echoes

Echoes are in-process scheduled tasks - no system cron required. They run inside the always-on `mypensieve start` daemon.

| Echo | Default cron | What it does |
|------|-------------|--------------|
| `daily-log` | `0 20 * * *` | Queue an end-of-day journal reminder for the operator |
| `extractor` | `0 2 * * *` | Nightly memory extraction across all Pi sessions |
| `backup` | `30 2 * * *` | Tarball `~/.mypensieve/` and `~/.pi/agent/sessions/` |

The extractor echo also runs the synthesizer in report-only mode (gated by `extractor.synthesize_after`, default `true`).

---

## Agent team & model assignment

Default install ships 1 agent (Orchestrator). 3 more are available for council deliberations:

| Agent | Role |
|-------|------|
| **Orchestrator** (default) | Solo agent - handles everything in interactive sessions |
| Researcher (council) | Gathers facts, cites sources |
| Critic (council) | Challenges assumptions, identifies risks |
| Devil's Advocate (council) | Argues the opposite position |

### Model assignment

Each agent gets its own model - any provider, any model. No tiers, no restrictions.

```json
{
  "orchestrator": { "model": "ollama-cloud/nemotron-3-super" },
  "researcher":   { "model": "openrouter/minimax-m2.7" },
  "critic":       { "model": "openrouter/kimi-k2" },
  "devil-advocate": { "model": "anthropic/claude-sonnet-4-6" }
}
```

Or use a single model for everything - the install wizard handles both flows.

### Persona loadouts (v0.3.0+)

Maintain multiple switchable agent identities:

```bash
mypensieve persona list                  # show all loadouts, active starred
mypensieve persona create focus          # interactive wizard to define a new identity
mypensieve persona switch focus          # activate 'focus' for the next session
mypensieve persona show focus            # print the loadout's identity prompt
mypensieve persona delete focus          # delete (refuses to delete the active one)
```

Loadouts live at `~/.mypensieve/loadouts/<name>/` and are isolated from council personalities (which stay in `~/.mypensieve/persona/<council-agent>.md`).

---

## Creating custom skills

Skills are Pi-native `SKILL.md` files with MyPensieve frontmatter extensions.

### Skill file structure

Create a directory under `~/.pi/agent/skills/your-skill/SKILL.md`:

```markdown
---
name: your-skill
description: What this skill does
mypensieve_exposes_via: recall
mypensieve_priority: 10
---

Your skill instructions here. The agent reads this when invoking the skill.
```

### Frontmatter fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill identifier |
| `description` | Yes | Human-readable description |
| `mypensieve_exposes_via` | Yes | Which verb this skill backs: `recall`, `research`, `ingest`, `monitor`, `journal`, `produce`, `dispatch`, or `notify` |
| `mypensieve_priority` | No | Routing priority (lower = higher priority). Default: 50 |
| `mypensieve_match` | No | Conditional routing. Example: `{ field: "kind", value: "audio" }` |

### Routing

Skills self-declare which verb they back via `mypensieve_exposes_via`. The gateway picks them up automatically. If multiple skills back the same verb, `mypensieve_priority` determines which one handles a given call.

---

## Creating custom MCP servers

MCP servers are process-isolated tools that the gateway dispatches to via verb routing.

### MCP config format

Add your MCP to the config's MCP section:

```json
{
  "name": "your-mcp",
  "command": "node",
  "args": ["path/to/your-mcp/index.js"],
  "env": {}
}
```

### Routing MCPs to verbs

Add a routing rule in `~/.mypensieve/meta-skills/<verb>.yaml`:

```yaml
verb: monitor
default_target: cve-monitor
default_target_type: skill
rules:
  - name: your-custom-monitor
    target: your-mcp
    target_type: mcp
    match:
      field: target
      value: your-thing
    priority: 10
    enabled: true
```

---

## CLI commands

| Command | Description |
|---------|-------------|
| `mypensieve init` | Run the install wizard |
| `mypensieve start` | Start the daemon (echoes + Telegram if enabled) |
| `mypensieve cli` | Open an interactive CLI session |
| `mypensieve log` | Trigger the daily journal |
| `mypensieve extract` | Manually run memory extractor |
| `mypensieve synthesize [--apply] [--project <binding>]` | Run synthesizer (report-only by default) |
| `mypensieve persona list \| switch \| create \| show \| delete` | Manage persona loadouts |
| `mypensieve config edit` | Edit configuration |
| `mypensieve errors` | View error log |
| `mypensieve recover` | Run recovery actions |
| `mypensieve doctor` | Healthcheck |
| `mypensieve backup` | Manual backup |
| `mypensieve backup verify` | Verify backup integrity |
| `mypensieve restore <file>` | Restore from backup |
| `mypensieve deliberate` | Trigger council mode |
| `mypensieve agent add <name>` | Add an agent persona |
| `mypensieve skill add <name>` | Add a skill |

---

## Telegram setup

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Run `/setjoingroups` - Disable (bot won't join groups)
3. Run `/setprivacy` - Enable (bot only sees direct messages)
4. Add your bot token to `~/.mypensieve/.secrets/telegram.json`
5. Add your Telegram user ID to `config.channels.telegram.allowed_peers`
6. Enable the channel: `config.channels.telegram.enabled = true`

Only whitelisted peers can use the bot. Empty `allowed_peers` = reject everyone. Group chats are disabled by default; enabling them still enforces per-peer confirmation scoping (see v0.3.0 security notes above).

---

## Security posture

MyPensieve runs autonomously and talks to LLMs, so the threat surface is meaningful. The v0.3.0 defenses:

| Layer | Mechanism |
|-------|-----------|
| **Filesystem reads** | Deny-list (`/etc/shadow`, `~/.ssh/`, `.env*`, `*.pem`, etc.) enforced in Pi's `beforeToolCall` |
| **Filesystem writes** | Allow-list (`~/.mypensieve/`, cwd, `/tmp/`) enforced in `beforeToolCall` AND at the verb level for `produce.output_path` |
| **Bash commands** | Deny patterns for `sudo`, `rm -rf`, `chmod 777`, pipe-to-shell, `eval`, interpreter escapes |
| **Destructive dispatches** | Blocked until operator approval (`dispatch` verb). Default daemon policy is `deny` when no interactive confirm provider is present. |
| **Telegram peer scope** | Confirm prompts are bound to the requesting peer's Telegram user ID |
| **Audit log** | Every verb call recorded to `~/.mypensieve/logs/audit/` with success/fail status including operator-denied |
| **Secrets isolation** | Config-privacy rule prevents agent from reading `~/.mypensieve/.secrets/`; API keys never included in error contexts |

---

## Project structure

```
src/
  config/         Config schema, reader, writer, paths
  core/           Pi session wrapper, extension, scheduler, session-meta, persona-loadouts
  gateway/        8-verb gateway, dispatcher, confirm-providers, audit, routing
  memory/         5-layer memory + extractor + synthesizer + synthesizer-runner
  providers/      Factory + 4 provider-complete shims (Ollama / Anthropic / OpenAI / OpenRouter)
  skills/         Skill implementations, executor, registry
  ops/            Error handling, backup, cost tracking
  council/        Multi-agent deliberation, personas
  channels/       CLI + Telegram adapters (both with gateway + confirm wiring)
  wizard/         Install wizard (clack-based)
  cli/            Command router + subcommands (persona, synthesize, doctor, errors, ...)
  init/           Directory scaffold, extension bridge installer

tests/
  unit/           30+ suites covering dispatcher, confirm, loadouts, synthesizer, providers, extension
  integration/    Cross-phase suites
  e2e/            Full-product scenarios
  579 tests total, all passing
```

---

## Architecture docs

Deep-dive documentation for contributors and future self:

| Doc | What it covers |
|-----|---------------|
| [PI-FOUNDATION.md](docs/architecture/PI-FOUNDATION.md) | Pi as runtime foundation - the load-bearing decision |
| [META-SKILL-GATEWAY.md](docs/architecture/META-SKILL-GATEWAY.md) | 8-verb gateway - security + token efficiency |
| [MEMORY-ARCHITECTURE.md](docs/architecture/MEMORY-ARCHITECTURE.md) | 5-layer cognitive memory system |
| [MULTI-AGENT-RUNTIME.md](docs/architecture/MULTI-AGENT-RUNTIME.md) | Council mode - AutoGen GroupChat on Pi |
| [OPERATIONS.md](docs/architecture/OPERATIONS.md) | Daily journal, error handling, backup/restore |
| [MVP-DECISIONS.md](docs/architecture/MVP-DECISIONS.md) | All 23 MVP decisions |
| [IMPLEMENTATION-PLAN.md](docs/architecture/IMPLEMENTATION-PLAN.md) | 10-phase test-gated plan |

---

## Inspirations & acknowledgments

MyPensieve borrows selectively from many sources. Credit where it's due:

| Project | What we learned | Link |
|---------|----------------|------|
| **Pi** (`@mariozechner/pi-coding-agent`) | The runtime foundation. Agent loop, providers, sessions, skills, extensions. | [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono) |
| **mempalace** | Bitemporal triple-store schema, layered memory loader, source-lineage on records | [github.com/milla-jovovich/mempalace](https://github.com/milla-jovovich/mempalace) |
| **OpenClaw** | Per-peer channel session scope, decoupled embedding model idea | [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| **AutoGen** | Council architecture - GroupChat, speaker selection, max_round | [github.com/microsoft/autogen](https://github.com/microsoft/autogen) |
| **LangGraph Swarm** | Structured shared state channels (researchFindings, critiques, draft) | [github.com/langchain-ai/langgraph-swarm-py](https://github.com/langchain-ai/langgraph-swarm-py) |
| **MetaGPT** | Pub/sub by role concept | [github.com/geekan/MetaGPT](https://github.com/geekan/MetaGPT) |
| **disler/the-library** | Catalog/registry indirection pattern (verb routing) | [github.com/disler/the-library](https://github.com/disler/the-library) |
| **Cognition (Devin)** | "Don't Build Multi-Agents" - full shared transcript, no per-agent slicing | [cognition.ai/blog/dont-build-multi-agents](https://cognition.ai/blog/dont-build-multi-agents) |

### Special thanks

- **Mario Zechner** ([@badlogic](https://github.com/badlogic)) for Pi - the foundation that made MyPensieve possible
- The **Cognition** team for the hard-won lesson that multi-agent fragments context

---

## Contributing

MyPensieve is currently in **closed development** through v1. No external contributions are accepted at this time.

If you find a bug or have a feature suggestion:
- Open an issue on the [Issues page](https://github.com/HunterSreeni/MyPensieve/issues)
- Include steps to reproduce, expected behavior, and actual behavior
- For feature requests, explain the use case

Contributions will open after v1 ships. Watch the repo for updates.

---

## Roadmap

### v0.3.0 (current)
- Autonomous echoes (daily-log, extractor, backup)
- Operator-in-the-loop confirmations (CLI + Telegram inline buttons)
- Persona loadouts
- Multi-provider memory extraction + synthesizer pipeline
- Full gateway wiring in Telegram channel

### v0.4.0 (planned)
- MCP re-architecture and unified MCP executor
- Skills re-architecture (declarative schema, hot-reload)
- Memory semantic layer (L4) with embeddings enabled by default
- Discord channel adapter

### v1.0.0 (planned)
- Backup encryption at rest
- Per-channel embedded extractor modes
- Open external contributions

### v2.0.0 (planned)
- [Patronus](docs/drafts/PATRONUS.md) - the friend agent that defends against despair
- Skill self-creation (auto-detect repeated manual tasks)
- Loop A/B prompt evolution and routing optimization

---

## License

[MIT](LICENSE)

---

*Built iteratively in Claude Code sessions starting April 8, 2026.*
*Named after the Pensieve from Harry Potter - a basin where you store memories and revisit them later.*
