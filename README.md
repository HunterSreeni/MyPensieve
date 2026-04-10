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
- **Multi-channel** - CLI and Telegram in MVP. Same memory, different interfaces.
- **Council mode** - convene multiple AI agents with different models to debate a decision. Researcher gathers facts, Critic challenges assumptions, Devil's Advocate argues the opposite.
- **Per-agent model assignment** - assign any LLM from any provider to any agent. Mix Ollama, OpenRouter, Anthropic, or anything else freely.
- **Daily journal** - structured EOD ritual that captures wins, blockers, mood, energy. Queryable trends over time.
- **9 skills + 6 MCPs** - blog-seo, CVE monitoring, image/video/audio editing, web research, browser automation, and more.
- **Zero OAuth in MVP** - all bundled MCPs are free and keyless. No API keys needed to get started.

---

## Status: Pre-release (v0.1.x)

**MyPensieve is in active development.** The core framework (memory, gateway, skills, tests) is complete, but the interactive experience is not ready yet. Provider integration and the install wizard require the [Pi re-audit](docs/architecture/PI-REAUDIT-CHECKLIST.md) (scheduled April 13, 2026) before they can be wired up.

**Do not install for production use.** Current npm versions are deprecated. Wait for v0.2.0.

### For developers / contributors

```bash
git clone https://github.com/HunterSreeni/MyPensieve.git
cd MyPensieve
npm install
npm test          # 304 tests
npm run build     # compile TypeScript
node dist/cli/index.js --help
```

---

## Architecture overview

```
Operator
  |
  +--- CLI channel ----+
  |                     |
  +--- Telegram --------+---> Gateway (8 verbs)
                        |         |
                        |    +----+----+----+----+----+----+----+----+
                        |    |recall|research|ingest|monitor|journal|produce|dispatch|notify|
                        |    +----+----+----+----+----+----+----+----+
                        |         |
                        |    Skills (9) + MCPs (6)
                        |         |
                        v         v
                    Memory (5 layers)
                    L1: Decisions (JSONL + SQLite)
                    L2: Threads (JSONL + SQLite)
                    L3: Persona deltas
                    L4: Semantic search (optional, embedding-based)
                    L5: Raw sessions (Pi's JSONL)
```

### The 8 verbs

The agent never sees raw skill or MCP names. It interacts through 8 typed verbs:

| Verb | Purpose | Routes to |
|------|---------|-----------|
| `recall` | Query persistent memory | memory-recall skill |
| `research` | Web search + synthesize with citations | researcher skill + DuckDuckGo MCP |
| `ingest` | Convert files/URLs to structured text | PDF, audio, video, image skills |
| `monitor` | Check for changes (CVEs, packages, GitHub) | cve-monitor skill + gh-cli MCP |
| `journal` | Daily log - write, read, trends, review | daily-log skill |
| `produce` | Create content (blog posts, images, video) | blog-seo, image/video/audio skills |
| `dispatch` | External actions (git, GitHub PRs) | gh-cli MCP |
| `notify` | Send messages to operator | notification extension |

### Skills (9 custom)

| Skill | What it does |
|-------|-------------|
| `daily-log` | Structured EOD journal with mood/energy tracking |
| `memory-recall` | Query decisions, threads, persona across sessions |
| `researcher` | Plan-search-synthesize with citations |
| `cve-monitor` | CVE/package vulnerability tracking with diff-only alerts |
| `blog-seo` | SEO-aware blog drafting with Yoast-style scoring |
| `playwright-cli` | Browser automation (CLI only, blocked on Telegram) |
| `image-edit` | Resize, crop, convert, EXIF strip via sharp |
| `video-edit` | Convert, trim, extract frames via ffmpeg |
| `audio-edit` | Convert, trim, normalize via ffmpeg + whisper transcription |

### MCPs (6 bundled)

| MCP | Source | Auth |
|-----|--------|------|
| `datetime` | Built-in | None |
| `playwright` | Standard Playwright MCP | None |
| `duckduckgo-search` | [nickclyde/duckduckgo-mcp-server](https://github.com/nickclyde/duckduckgo-mcp-server) | None |
| `whisper-local` | [jwulff/whisper-mcp](https://github.com/jwulff/whisper-mcp) | None |
| `gh-cli` | [kousen/gh_mcp_server](https://github.com/kousen/gh_mcp_server) | None (uses `gh auth`) |
| `cve-intel` | Custom (~300 LOC) | None (OSV.dev + NVD + EPSS + CISA KEV) |

Zero OAuth flows in MVP. All APIs are free and keyless.

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
  "researcher": { "model": "openrouter/minimax-m2.7" },
  "critic": { "model": "openrouter/kimi-k2" },
  "devil-advocate": { "model": "anthropic/claude-sonnet-4-6" }
}
```

Or use a single model for everything - the install wizard handles both flows.

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
| `mypensieve start` | Start an interactive CLI session |
| `mypensieve log` | Trigger the daily journal |
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
| `mypensieve extract` | Manually run memory extractor |

---

## Telegram setup

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Run `/setjoingroups` - Disable (bot won't join groups)
3. Run `/setprivacy` - Enable (bot only sees direct messages)
4. Add your bot token to `~/.mypensieve/.secrets/telegram.json`
5. Add your Telegram user ID to `config.channels.telegram.allowed_peers`
6. Enable the channel: `config.channels.telegram.enabled = true`

Only whitelisted peers can use the bot. Empty `allowed_peers` = reject everyone.

---

## Project structure

```
src/
  config/         Config schema, reader, writer, paths
  core/           Pi session wrapper, extension entry point
  gateway/        8-verb gateway, routing, dispatcher, audit
  memory/         5-layer memory, SQLite index, checkpoint
  skills/         9 skill implementations, executor, registry
  ops/            Error handling, backup, cost tracking
  council/        Multi-agent deliberation, personas
  channels/       CLI + Telegram adapters
  wizard/         9-step install wizard
  cli/            Command router, doctor, errors
  init/           Directory scaffold
  utils/          JSONL utilities
  projects/       Project loader

tests/
  unit/           20 suites
  integration/    5 suites (cross-phase)
  e2e/            1 suite (full product scenarios)
  304 tests total, all passing

docs/
  architecture/   Locked architecture decisions + implementation plan
  drafts/         v2 feature specs (Patronus, etc.)
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
| **Pi** (`@mariozechner/pi-coding-agent`) | The runtime foundation. Agent loop, providers, sessions, skills, extensions. MyPensieve is built on Pi. | [github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono) |
| **mempalace** | Bitemporal triple-store schema, layered memory loader, source-lineage on records | [github.com/milla-jovovich/mempalace](https://github.com/milla-jovovich/mempalace) |
| **OpenClaw** | Per-peer channel session scope, decoupled embedding model idea | [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| **AutoGen** | Council architecture - GroupChat, speaker selection, max_round | [github.com/microsoft/autogen](https://github.com/microsoft/autogen) |
| **LangGraph Swarm** | Structured shared state channels (researchFindings, critiques, draft) | [github.com/langchain-ai/langgraph-swarm-py](https://github.com/langchain-ai/langgraph-swarm-py) |
| **MetaGPT** | Pub/sub by role concept | [github.com/geekan/MetaGPT](https://github.com/geekan/MetaGPT) |
| **disler/the-library** | Catalog/registry indirection pattern (verb routing) | [github.com/disler/the-library](https://github.com/disler/the-library) |
| **Cognition (Devin)** | "Don't Build Multi-Agents" - full shared transcript, no per-agent slicing | [cognition.ai/blog/dont-build-multi-agents](https://cognition.ai/blog/dont-build-multi-agents) |

### Special thanks

- **Mario Zechner** ([@badlogic](https://github.com/badlogic)) for Pi - the foundation that made MyPensieve possible in a single day of implementation
- The **Cognition** team for the hard-won lesson that multi-agent fragments context

---

## Contributing

MyPensieve is currently in **closed development** through v2. No external contributions are accepted at this time.

If you find a bug or have a feature suggestion:
- Open an issue on the [Issues page](https://github.com/HunterSreeni/MyPensieve/issues)
- Include steps to reproduce, expected behavior, and actual behavior
- For feature requests, explain the use case

Contributions will open after v2 ships. Watch the repo for updates.

---

## Roadmap

### v0.1.0 (current)
- 10-phase MVP framework complete
- 26 test suites, 304 tests passing
- Pending: Pi re-audit (April 13, 2026) for full interactive mode

### v1.0.0 (planned)
- Full Pi interactive mode integration
- Real MCP connections (DuckDuckGo, Playwright, whisper, gh-cli)
- Install wizard with interactive prompts

### v2.0.0 (planned)
- [Patronus](docs/drafts/PATRONUS.md) - the friend agent that defends against despair
- Discord channel adapter
- Skill self-creation (auto-detect repeated manual tasks)
- Loop A/B prompt evolution and routing optimization
- Backup encryption at rest
- Open contributions

---

## License

[MIT](LICENSE)

---

*Built iteratively in Claude Code sessions starting April 8, 2026.*
*Named after the Pensieve from Harry Potter - a basin where you store memories and revisit them later.*
