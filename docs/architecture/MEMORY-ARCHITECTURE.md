# MyPensieve - Memory Architecture
> Status: LOCKED | Created: 2026-04-08 | Revised after Pi research
> **Read PI-FOUNDATION.md first.**
> Companion to TOOLSHED-BRIDGE-ARCHITECTURE.md, PROVIDERS.md, MULTI-AGENT-RUNTIME.md.
> This doc covers HOW MyPensieve remembers, retrieves, and forgets across sessions.

**Important:** Pi (the foundation) **already provides raw session persistence** as append-only JSONL files at `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<id>.jsonl` with branches, forks, resume, and schema migration. **MyPensieve does not maintain its own raw transcript layer.** Our memory extension reads from Pi's session JSONL files via Pi's `TurnEndEvent` and `SessionShutdownEvent` hooks. The 5-layer cognitive model, distilled records, persona files, project state, and embeddings are still our work - Pi has nothing in those areas.

---

## WHY THIS DOC EXISTS

A general-purpose autonomous agent OS needs more than a chat history. It needs:

- A persistent model of who the operator is (user persona) and who the OS itself is (LLM persona)
- Cross-session recall of decisions, rationale, and research
- A way to answer "what did we decide about X, and when?" weeks or months later
- All of the above without blowing up token budgets or context windows

This doc lays out a five-layer cognitive memory model, the storage tiers behind it, the session protocol that ties them together, and the efficiency rules that keep the whole thing cheap as history grows from 100 sessions to 10,000.

**Audience:** anyone implementing or extending MyPensieve. The architecture is general-purpose - it does not assume any specific operator, project, or use case.

---

## THE MENTAL MODEL: CONSCIOUS / UNCONSCIOUS

```
┌─────────────────────────────────────────────────────────────┐
│ L0  IDENTITY          ~200 tok    always loaded             │
│     Who the operator is, who the OS is. Rarely changes.     │
├─────────────────────────────────────────────────────────────┤
│ L1  WORKING MEMORY    ~2k tok     current session only      │
│     Raw transcript buffer. Dies when session ends.          │
│     = "what I'm saying right now"                           │
├─────────────────────────────────────────────────────────────┤
│ L2  CONSCIOUS         ~3-5k tok   loaded at session start   │
│     Active project state + last 7d decision timeline +      │
│     open threads. = "what I'm thinking about this week"     │
├─────────────────────────────────────────────────────────────┤
│ L3  PRECONSCIOUS      on-demand   retrieved by query        │
│     30-90d window. Symbolic-indexed. Cheap fetch.           │
│     = "what I can recall when prompted"                     │
├─────────────────────────────────────────────────────────────┤
│ L4  UNCONSCIOUS       on-demand   semantic + symbolic       │
│     Everything ever. Embeddings + bitemporal KG.            │
│     = "what I know but isn't top-of-mind"                   │
└─────────────────────────────────────────────────────────────┘
```

**The core trick:** higher layers (L2, L3) are **pre-digested artifacts produced between sessions**, so live sessions never pay the cost of reading raw history. Sessions consume cache; extractors and synthesizers fill the cache when no human is waiting.

---

## THREE STORAGE TIERS

| Tier | Format | Written by | Read by | Lifetime |
|------|--------|-----------|---------|----------|
| **Raw** | **Pi's JSONL session trees** at `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<id>.jsonl` | **Pi (live during session)** | MyPensieve extractor extension via `TurnEndEvent` / `SessionShutdownEvent` hooks | Forever (Pi-managed) |
| **Distilled** | Structured records (decisions, facts, threads, research) - JSONL source-of-truth at `~/.mypensieve/projects/<name>/*.jsonl` + SQLite derived index at `~/.mypensieve/index/memory.sqlite` | MyPensieve post-session extractor + nightly job | MyPensieve at session start, queries during sessions | Forever |
| **Synthesized** | Project state docs, persona files, weekly digests (markdown) at `~/.mypensieve/projects/<name>/state.md` and `~/.mypensieve/workspace/personas/` | MyPensieve nightly synthesizer | Injected into Pi's system prompt via persona-injector extension | Refreshed continuously |

**Source-of-truth principle:** Pi's raw session JSONL is the ultimate source of truth. MyPensieve's distilled JSONL is the indexed extract. SQLite is the derived query cache. Synthesized markdown is the high-level cache. Higher tiers can always be rebuilt from raw if corrupted or if the schema changes. Every distilled record carries `source: <pi-session-id>:<turn-number>` so the lineage back to Pi's raw is preserved.

**Why we do not maintain our own raw layer:** Pi already does this correctly with branches, forks, resume, and migration. Duplicating it would mean two sources of truth and inevitable drift. Our extractor reads Pi's session files - it does not write them.

### Why hybrid distilled storage (DECISION 1, LOCKED)

The distilled layer is the answer to: "what stores decisions, facts, threads, and the index that powers cross-session queries?"

**Locked choice: Hybrid - JSONL as source-of-truth + SQLite as derived index.**

- All writes go to append-only JSONL files (`decisions.jsonl`, `facts.jsonl`, `threads.jsonl`) - the source of truth
- A `mypensieve reindex` command rebuilds SQLite from JSONL whenever schema changes or drift is suspected
- All reads/queries go through SQLite (treat it as a cache)
- Backup = the JSONL files; SQLite is disposable
- Schema migrations are non-destructive: drop SQLite, change schema, reindex from JSONL

This gives plain-text trust (operator can `cat` and `grep` their own data, version with git) plus fast indexed queries. It is the same pattern git uses internally - objects on disk, packed indexes derived. It is also the pattern mempalace uses (raw transcripts, ChromaDB for retrieval).

---

## WHAT GETS EXTRACTED FROM EVERY SESSION

After each session ends (and again on the nightly cron pass), the extractor agent writes these record types to the distilled layer.

### 1. Decisions (the most important record type)

```json
{
  "id": "dec-2026-04-08-001",
  "schema_version": 1,
  "timestamp": "2026-04-08T22:15:00+05:30",
  "project": "mypensieve",
  "topic": "memory-architecture",
  "decided_by": "user",
  "content": "Adopt 5-layer cognitive memory model with L0-L4 tiers",
  "reason": "Need cross-session recall without blowing token budgets",
  "alternatives_considered": ["flat vector RAG", "single decision log only"],
  "research_artifacts": ["research/mempalace-deep-dive-2026-04-08.md"],
  "supersedes": null,
  "confidence": "confirmed",
  "source": "session-2026-04-08-002:turn-47"
}
```

Stored as one-line JSONL in `projects/<project>/decisions.jsonl` for fast tail-reads, plus indexed in SQLite for cross-project queries. A decision has **5 required fields**: what, why, when, who decided, source. If the extractor cannot fill all five, it is not a decision - it might be a fact, thread, or persona delta instead.

### 2. Facts (bitemporal triples)

Schema lifted directly from mempalace's `knowledge_graph.py`:

```
(subject, predicate, object, valid_from, valid_to, confidence, source)
```

Examples:

- `(mypensieve, depends_on, ollama, 2026-04-08, null, 0.95, session-...)`
- `(operator, prefers_tone, terse, 2026-03-01, null, 0.95, session-...)`
- `(skill:morning-briefing, best_model, nemotron-3-super, 2026-04-01, 2026-04-15, 0.7, routing-stats)`

Bitemporal means every fact has `valid_from` and `valid_to`. Historical queries ("what was true on April 8?") work cleanly. Superseded facts are not destroyed - just invalidated by setting `valid_to`.

### 3. Research artifacts

Any agent report, web fetch, or research output is saved as a hash-addressed file under `research/` and **referenced by ID** from decisions that cite it. Decisions stay small; research stays retrievable.

### 4. Open threads

Things explicitly left unfinished. One line each. Loaded into L2 next session if same project.

### 5. Persona deltas

New things learned about the operator (preferences, expertise, current obsessions) or stylistic feedback the LLM should absorb. Applied to persona files during nightly synthesis, not live.

---

## EXTRACTOR SCHEDULE (DECISION 2, LOCKED)

**Question:** When does the extractor run, and what does it cost?

**Locked choice: Raw live (handled by Pi) + extractor at session-end + nightly cron + manual `extract` command.**

### During session (zero LLM cost)

- **Pi handles raw transcript writes automatically** - every turn is appended to the session JSONL by Pi's session-manager. MyPensieve does nothing here.
- Operator can drop a manual marker mid-conversation: type `/decide <thing>` or start a message with `DECISION:` - **a MyPensieve extension catches this** via Pi's `TurnEndEvent` or message-input hook and writes a flag record to `~/.mypensieve/projects/<active>/markers.jsonl` indicating which turn in Pi's session JSONL is a decision candidate. Still no LLM call - just a file write.
- That is it. Live writes are free, fast, never block the user.

### Triggered later (LLM does the work)

A MyPensieve extractor reads Pi's raw session JSONL + any manual markers and writes structured records (decisions, facts, threads, persona deltas) to the distilled layer.

| Trigger | When | How |
|---|---|---|
| **Session end** | Automatic, when Pi's `SessionShutdownEvent` fires (operator types `exit` or session times out) | MyPensieve extension subscribes to the event, reads the just-finished session's JSONL from `~/.pi/agent/sessions/...`, runs the deep-tier model via `pi-ai.complete()`, writes distilled records to `~/.mypensieve/projects/<active>/` |
| **Daily cron** | Configurable time, default 02:00 local | Standalone Node script (or Pi RPC call) that walks all Pi session JSONL files modified since last run, runs the extractor on any not yet processed; also runs synthesis (state.md updates, persona deltas, weekly digest) |
| **Manual** | `mypensieve extract` command | Operator wants to query today's decisions later today in a fresh session - runs the same logic as the nightly cron, on-demand |

Reasoning: zero session-time tokens, zero session-time latency, crash-resilient (Pi's raw JSONL has everything even if our extractor fails; nightly cron picks it up). The expensive deep-tier pass happens when no human is waiting.

---

## THE TWO PERSONA FILES

### `workspace/personas/user.md` - the operator's evolving profile

- Role, goals, constraints
- Communication style (terse vs verbose, etc.)
- Current obsessions and active projects
- Working hours, energy patterns
- Domain expertise + known knowledge gaps

Seeded by the first-run install wizard (operator answers a few questions). Updated by the nightly synthesizer when persona deltas accumulate. **Never updated by live sessions** to avoid drift mid-conversation.

### `workspace/personas/llm.md` - the OS's evolving voice

- Operating principles
- Response style preferences confirmed by the operator
- Tools/approaches the operator has validated
- Tools/approaches the operator has rejected (with reason)

Same write rules: nightly synthesizer only.

Both files are versioned in `workspace/personas/history/`. Both load into L0/L1 every session.

---

## PROJECT BOUNDARIES (DECISION 3, LOCKED)

**Question:** How does MyPensieve know which project a session belongs to?

**Locked choice: Channel-bound origination + filesystem registry + no active pointer.**

This is the most consequential decision in the doc. It affects session start cost, multi-project conversations, multi-channel deployments, and security. Read this section carefully.

### Filesystem-as-registry

Any folder under `~/.mypensieve/projects/` is a project. No registry file, no active pointer, no metadata. The folder IS the project.

- Created by `mkdir` (manual) or by the extractor when it identifies a new project name in conversation
- Deleted by `rm -rf` (decisions tagged with that project become orphaned references; extractor warns at next run)
- Listed by `ls`

A special project called `untagged` always exists as the default fallback.

### Channel-bound origination

The other half of the answer: **where a session starts from determines what project loads.**

Every channel a session can originate from (CLI, Telegram, Discord, future WhatsApp/Slack/etc.) has its own folder under `~/.mypensieve/channels/<type>/<id>/`. Each contains a single `binding.json`:

```json
{
  "project": "mypensieve",
  "auto_bound": false,
  "bound_at": "2026-04-08T22:15:00+05:30",
  "allowed_skills": ["*"],
  "denied_skills": [],
  "allowed_mcps": ["filesystem", "telegram"],
  "denied_mcps": ["shell"]
}
```

This binding tells MyPensieve three things:
1. Which project to load when a session starts here
2. Which skills can be invoked from this channel (security)
3. Which MCPs can be enabled from this channel (security)

### How session start works

1. Session opens via channel X with peer Y
2. Channel identifier built: `cli/<cwd-slug>` or `telegram/<chat-id>` or `discord/<guild-channel>`
3. OS looks up `channels/<type>/<id>/binding.json`
4. **If binding exists:** load identity + personas + that project's `state.md` + recent decisions for that project (~4-5k tok, bounded, no project index)
5. **If no binding exists:** auto-create channel folder, write `binding.json` with `untagged`, load identity + personas only (~700 tok). Operator can `/bind <project>` later to lock.
6. **No global project index loaded ever.** This saves ~1k tok per session compared to a project-summary-loader approach.

### Smart auto-binding for CLI

When a CLI session starts in a directory:

- If `pwd` basename matches an existing project name → auto-bind to that project
- If `pwd` contains a `.mypensieve-project` marker file → bind to the project named in that file
- Otherwise → bind to `untagged`

This means `cd ~/code/foo && mypensieve start` just works. No ceremony.

### Mid-session project switching

Operator can `/bind <project>` mid-session. Updates `binding.json` for the current channel. Does not reload context immediately (cheap), just affects extraction tagging and next session start.

### Multi-project conversations still work

Channel binding decides what is **loaded** at session start. The post-session extractor still tags decisions per-project based on actual content. So a session bound to project `foo` that drifts into project `bar` produces decisions tagged for both projects (linked by ID, not duplicated).

### Multi-tenant safety

For deployments where a Telegram bot is reachable by multiple peers, the binding key is `(channel-type, channel-id, peer-id)`, not just `(channel-type, channel-id)`. Each peer gets their own binding. This is the open-claw `dmScope: per-channel-peer` pattern, lifted directly. For single-operator MVP this collapses to `(channel-type, channel-id)`.

---

## SESSION PROTOCOL

```
SESSION START
  ├── Identify channel: cli/<cwd> | telegram/<chat-id> | discord/<...>
  ├── Look up channels/<type>/<id>/binding.json
  ├── Load L0: identity + both personas         (~700 tok)
  ├── If binding found and project != untagged:
  │     Load L2: project_state.md + last 7d decisions (~3-4k tok)
  ├── If resuming: load last session's open-threads (~500 tok)
  └── Total wake-up: ~700 tok (untagged) to ~5k tok (bound). Bounded.

DURING SESSION
  ├── Append everything to raw JSONL (free, no LLM cost)
  ├── On `/decide` or `DECISION:` marker: write provisional flag to JSONL
  ├── Cross-session queries hit symbolic SQLite index FIRST
  └── Semantic search (L4) only as fallback when symbolic returns nothing

SESSION END
  ├── Extractor (Sonnet) reads raw → writes distilled records
  ├── Updates project_state.md (Opus, only if material change)
  └── Generates handoff notes = next session's L1 seed

NIGHTLY (cron, default 02:00)
  ├── Re-index any new distilled records into SQLite
  ├── Generate L4 embeddings for new records (nomic-embed-text via Ollama)
  ├── Update persona files if deltas accumulated and pass contradiction check
  └── If Sunday: weekly synthesis (Opus reads week's decisions → digest)

MANUAL
  └── `mypensieve extract` runs the post-session pass on demand
```

---

## EMBEDDING MODEL (DECISION N1, LOCKED)

L4 (the "unconscious" layer) uses a hybrid retrieval approach: 70% vector cosine similarity + 30% BM25 keyword search, mirroring the open-claw pattern.

**Locked choice: embeddings are NOT tier-routed. They live in their own config field.** L4 is **optional**: if no embedding provider is configured, MyPensieve still runs - it just disables semantic search and falls back to symbolic-only retrieval (which already covers 80%+ of queries).

**Suggested default: `nomic-embed-text` via local Ollama** if Ollama is configured.

- 137M parameters, ~270MB on disk
- Runs offline, costs nothing, keeps data private
- 768-dimensional embeddings
- Truly decoupled from the chat model

**Override path:** the user can pick any embedding-capable provider/model via `mypensieve config edit`. Examples: OpenAI `text-embedding-3-small`, Voyage `voyage-3`, Cohere `embed-v3`, or any other Ollama embedding model.

**Why embeddings get their own config field (not a tier_hint):**

- Embedding is a different operation type than text completion. It does not need a `tier_hint` because there is only one task class (turn text into a vector).
- Tier routing is for capability-vs-cost tradeoffs in completions. Embeddings just need to be **available** and **dimensionally consistent** within an install.
- Hardcoding embeddings outside the tier system makes it explicit that L4 is a specialized subsystem, not a model class.

### Embedding config in `config.json`

```json
{
  "embedding": {
    "enabled": true,
    "provider": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 768
  }
}
```

If `enabled: false` or the section is missing, L4 is disabled, the `embeddings.sqlite` index is not maintained, and semantic search calls return "L4 disabled" cleanly.

### Install rule: embeddings are part of the multi-step wizard

The first-run wizard sets up embeddings as a multi-step, explained, verified phase. Every step shows what it is doing, why, the verify check, and how to skip or override. No magic, no silent installs.

```
$ mypensieve init
...
[Step 6 of 9] Setting up embeddings (optional but recommended)

Why this step:
  MyPensieve uses embeddings to find old memories by meaning, not just
  keywords. A small AI model converts text into vectors. This powers
  the L4 unconscious memory layer (semantic search).

  Without embeddings, MyPensieve still works fine - you just lose semantic
  search across long-tail history. Symbolic queries (date, project,
  category) still work.

Recommended setup: nomic-embed-text via Ollama (local, free, private)

Available embedding providers based on your earlier provider config:
  [1] ollama / nomic-embed-text  (recommended, ~270MB local)
  [2] openai / text-embedding-3-small  (cloud, paid, requires OpenAI provider)
  [3] skip  (disable L4 semantic search)

Select: 1

[1] Check if Ollama is installed... ✓
[2] Check if Ollama daemon is running... ✓
[3] Pull nomic-embed-text model... [downloading 270MB] ✓
[4] Test embedding (turning "hello world" into a vector)... ✓ 768 dims
[5] Write embedding config to ~/.mypensieve/config.json... ✓

Embedding setup complete.
```

This pattern - educate, choose, verify, allow override or skip - is the design rule for the entire install wizard, not just embeddings.

**See [PROVIDERS.md](PROVIDERS.md) for the full provider abstraction and how it interacts with the rest of the system.**

---

## CONFIG LAYOUT (DECISION N3, LOCKED)

**Locked choice: Single read-only `config.json`, secrets separate, only `init` and `config edit` can write.**

### The read-only design

Config is **user intent**, not runtime state. The OS reads it, never writes it. Three reasons:

1. **Safety:** prevents a compromised or buggy agent from disabling safety rules
2. **Trust:** operator always knows their config is what they put there
3. **Clarity:** runtime state lives elsewhere, cannot pollute config

### Filesystem layout

```
~/.mypensieve/
├── config.json              # mode 0444 at runtime (read-only for everyone)
├── .secrets/                # mode 0700 dir, secrets stored as individual files
│   ├── anthropic_oauth
│   ├── openrouter_key
│   ├── telegram_bot_token
│   └── ...
├── state/                   # OS-writable runtime state
│   ├── current-session
│   ├── last-extraction
│   └── ...
├── workspace/               # global identity, personas, skills, mcps
│   ├── identity.md          # L0 - rarely changes
│   ├── personas/
│   │   ├── user.md
│   │   ├── llm.md
│   │   └── history/
│   ├── skills/              # toolshed, see TOOLSHED-BRIDGE-ARCHITECTURE.md
│   └── mcps/                # MCP server registry
├── projects/                # filesystem-as-registry
│   ├── untagged/            # always exists, default fallback
│   │   ├── state.md
│   │   ├── decisions.jsonl
│   │   ├── facts.jsonl
│   │   └── threads.jsonl
│   ├── <project-1>/
│   └── <project-2>/
├── channels/                # channel registry, see project boundaries section
│   ├── cli/
│   ├── telegram/
│   └── ...
├── sessions/                # raw transcripts (one JSONL per session)
│   └── <session-id>.jsonl
├── index/                   # derived SQLite indexes (rebuildable)
│   ├── memory.sqlite        # decisions, facts, threads
│   ├── facts.sqlite         # bitemporal KG
│   └── embeddings.sqlite    # L4 vector + BM25
├── research/                # hash-addressed research artifacts
│   └── <hash>.md
├── digests/                 # synthesized summaries
│   ├── weekly/
│   └── monthly/
└── logs/
    ├── errors/
    ├── decisions/
    ├── cost/
    └── audit/               # bridge audit log (every skill/mcp invocation)
```

### Two commands can write `config.json`

| Command | Purpose | What it does |
|---|---|---|
| `mypensieve init` | First install | Wizard creates config.json, writes it, then chmods to 0444 |
| `mypensieve config edit` | User-initiated change | Lifts chmod, opens `$EDITOR`, validates new config, re-chmods to 0444 |

The daemon, agents, extractors, and all skills run with **zero write access** to config.json. Enforced at the filesystem level.

### Secrets are NOT in config.json

Config references secrets by **name**, not value:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token_secret": "telegram_bot_token"
    }
  }
}
```

The OS resolves `telegram_bot_token` from `~/.mypensieve/.secrets/telegram_bot_token` at runtime. This keeps config rotatable, inspectable, and shareable (operator can paste config.json in a bug report without leaking keys).

### What goes in config.json

- Enabled channels and their settings (excluding secrets)
- **Providers** - registered AI providers and their auth method (see PROVIDERS.md)
- **Routing** - tier_hint → provider/model resolution map (see PROVIDERS.md)
- **Overrides** - per-skill or per-agent model pinning (see PROVIDERS.md)
- Embedding config (provider, model, dimensions, enabled flag)
- Token budget caps
- Allowlists (allowed-repos, allowed-domains, blocked-commands)
- Extractor schedule (cron times)
- Persona drift thresholds
- Skill enable/disable flags

### What does NOT go in config.json

- Secrets (→ `.secrets/`)
- Session state (→ `state/`)
- Active-channel pointer or last-session ID (→ `state/`)
- Stats, metrics, learning data (→ `index/`)
- Anything the OS computes (→ `state/` or `index/`)

---

## THREE EXAMPLE QUERIES (THE ACCEPTANCE TESTS)

These three queries are the acceptance test for the memory architecture. If any of them fails or costs more than the budget below, the design is wrong.

### Query 1 - Day 0
**Operator:** "I'm making decisions on memory architecture for my new project `foo`. It will compete with X."

**What happens:**
- Session originates from CLI in `~/code/foo/`. Channel binding auto-detects → project `foo`
- Live: operator's `/decide` markers (or post-session extractor) catch decision-language
- Writes `dec-NNNN-001` to `projects/foo/decisions.jsonl`
- Writes fact triple `(foo, competes_with, X, day-0, null, 0.9, ...)`
- Updates `projects/foo/state.md` with "Memory architecture: in design"

### Query 2 - Day 14 (two weeks later, new session)
**Operator:** "Let's code the memory module."

**What happens:**
- Session originates from CLI in `~/code/foo/`. Channel binding loads project `foo`
- Loads `projects/foo/state.md` (~2k tok) + last 7d `decisions.jsonl` filtered by topic~memory (~1k tok)
- LLM **already has the day-0 decisions in context** at session start
- Codes against them with no extra retrieval
- **Cost: ~3k tokens of context, zero search calls**

### Query 3 - Day 30 (one month later)
**Operator:** "What memory architecture decisions have we made and when? I want to refine the design."

**What happens:**
- Orchestrator runs symbolic query against decisions index:
  ```sql
  SELECT * FROM decisions
  WHERE project='foo' AND topic LIKE '%memory%'
  ORDER BY timestamp;
  ```
- Returns timeline with citations back to source sessions
- Inlines decision one-liners directly into response
- Only escalates to L4 semantic search if symbolic returns < N results
- **Cost: ~500 tokens for query + decisions, no embeddings used**

---

## TOKEN EFFICIENCY RULES (NON-NEGOTIABLE)

1. **Pay between sessions, not during.** Extractors and synthesizers run when no human is waiting. Live sessions only consume pre-digested artifacts.
2. **Symbolic before semantic.** Date + entity + project filters answer ~80% of queries for free. Embeddings are the fallback, not the default.
3. **Hard token caps per layer:**
   - L0 + personas: ~700 tok max
   - L1 (resume seed): ~500 tok max
   - L2 (project state + 7d decisions): ~3-4k tok max
   - **Total wake-up ceiling: ~5k tok**
4. **Decisions as one-liners.** Compressed format: `[date | project | topic | decided_by | content | →source]`. 100 decisions = ~3k tokens. A whole project's decision history fits in L2.
5. **Raw is never read live.** Only extractors touch raw JSONL. This is the rule that keeps costs flat as history grows from 100 sessions to 10,000.
6. **One project = one state file.** The OS knows which project the channel is bound to and only loads that one. Other projects stay cold.
7. **Compaction has rules, not vibes.** When `project_state.md` exceeds 2k tokens, the synthesizer demotes decision *rationale* to L3 but keeps decision *headers* in L2. Headers always cite L3 sources by ID.

---

## WHAT GETS LIFTED FROM MEMPALACE

Verdict from the deep-research report: **adapt selectively, do NOT install the package.** Mempalace is built for conversation recall; MyPensieve memory is structured agent state. But four pieces map cleanly:

| From mempalace | Used in MyPensieve for |
|----------------|----------------------|
| `knowledge_graph.py` bitemporal triple schema (~400 lines SQLite) | L4 facts layer + future Loop B routing table |
| `MemoryStack.wake_up()` layered loader pattern (`layers.py`) | The session-start protocol above |
| Diary primitive (`mempalace_diary_write/read` in `mcp_server.py`) | `decisions.jsonl` append-only format per project |
| Source-lineage on every record | Every distilled record cites raw `session-id:turn-number` |

**Skipped from mempalace:**
- ChromaDB as primary store (only used for L4 fallback semantic search)
- Wings/halls/closets/drawers metaphor (overhead for data we do not have)
- AAAK dialect (regresses accuracy)
- The `pip install` itself (lift code under MIT, not the dependency tree)

---

## WHAT GETS LIFTED FROM OPEN-CLAW

| From open-claw | Used in MyPensieve for |
|---|---|
| Workspace directory convention | `workspace/` for global state (identity, personas, skills, mcps) |
| `SOUL.md` as read-only identity loaded fresh per session | `workspace/identity.md` matches our L0 |
| Daily logs auto-loaded by recency (today + yesterday) | Validates the "last 7 days of decisions in L2" pattern |
| Hybrid vector + BM25 retrieval | L4 retrieval uses both, weighted ~70/30 |
| Decoupled embedding model (nomic-embed-text via Ollama) | L4 embeddings come from a small local model, not the chat model |
| Single config file pattern | `config.json` (read-only, see N3) |
| Per-peer session isolation (`dmScope: per-channel-peer`) | Channel binding key is `(channel-type, channel-id, peer-id)` for multi-tenant safety |

**Diverged from open-claw:**
- Single-agent-per-gateway (we want multi-project)
- Global memory file (we want per-project isolation)
- Channels as pure input plumbing (we make channels first-class with project bindings)

---

## HARD UNSOLVED PROBLEMS WITH RESOLVED APPROACHES

### P1 - Decision detection rubric

A **decision** has 5 required fields: **what, why, when, who decided, source**. If extractor cannot fill all 5, it is not a decision. It might be a fact, thread, or persona delta.

**Real-time markers (zero LLM cost):**
- Operator types `/decide <thing>` or starts a message with `DECISION:`
- That turn gets flagged in raw JSONL for the extractor to prioritize

**Post-session Opus catches:**
- Rationale-bearing action statements (`X because Y`)
- Architecture, tool, and design choices
- Scope cuts ("not building X for MVP")
- Approval or rejection of an LLM proposal
- Anything operator marks as "important" or "remember this"

**Explicitly NOT decisions:**
- Aspirations ("I want to build X someday")
- Open questions ("should we use X?") - unless followed by an answer in the same session
- Hypotheticals ("if we used X, then Y")
- Preferences without action ("I like terse responses") → these are **persona deltas**

### P2 - Project disambiguation

Resolved by Decision 3: channel binding determines the default project at session start. Mid-session project switches via `/bind <project>`. When ambiguous-ask happens, the OS records the operator's answer as a fact triple `(session-id, belongs_to_project, project-name)` so the heuristic improves.

### P3 - Compaction without loss

When `projects/<name>/state.md` exceeds 2k tokens, the synthesizer compacts:

1. Decision **headers** (one line each) stay in `state.md`
2. Decision **rationale, alternatives, citations** move to L3 (still in `decisions.jsonl`, just not loaded at session start)
3. Any decision marked `pinned: true` always stays in full regardless of age or size
4. Last 7 days of decisions always stay in full
5. Older decisions demoted in batches by week
6. Compaction is logged to `projects/<name>/compaction.log` - operator can see what got demoted when
7. Compaction is reversible: if a demoted decision is referenced in a session, it gets re-promoted

### P4 - Persona drift

`workspace/personas/llm.md` and `workspace/personas/user.md` are **never updated by live sessions.** Only the nightly synthesizer touches them.

- Synthesizer reads the day's persona deltas from distilled records
- For each delta, asks: "does this contradict the current persona file?"
- No contradiction → merge silently
- Contradiction → write to `personas/pending.md`, surface at next session start: "noticed feedback that may shift the operator/LLM profile - confirm or reject?"
- All edits go to `personas/history/` versioned snapshots
- Weekly digest includes a persona drift summary
- Operator can roll back any persona version with `mypensieve persona rollback <version>`

### P5 - Schema migration

Raw JSONL is the source of truth. Distilled SQLite is rebuildable. Migration approach:

- Every record has `schema_version: <n>`
- Schema changes within same major version are backward-compatible (new fields optional, old fields never removed)
- Major version bumps trigger explicit `mypensieve migrate` command
- `mypensieve migrate` creates a checkpoint first, drops SQLite tables, re-runs extractor over all raw JSONL with the new schema, rebuilds index
- For very large histories: incremental, batched, resumable
- Never edit distilled records in place

---

## RELATIONSHIP TO OTHER ARCHITECTURE DOCS

This memory subsystem **complements** the rest of the architecture:

| Other doc / component | How it fits the memory system |
|---|---|
| TOOLSHED-BRIDGE-ARCHITECTURE.md | Skills are invoked via the bridge; their execution logs feed the distilled layer. Skill performance stats become bitemporal facts in the KG. |
| Loop A (skill prompt evolution) | Extractor writes prompt-edit deltas as decisions in `projects/mypensieve-skills/decisions.jsonl`. Skill evolution becomes a queryable history. |
| Loop B (statistical routing) | Bitemporal facts table holds `(skill, best_model, model_id, valid_from, valid_to)` triples. Routing becomes time-aware. |
| Decision Log (master outline) | This **is** the decision log, generalized: per-project `decisions.jsonl` files indexed in SQLite. |
| Per-skill `learnings.json` | Becomes a view over the facts table filtered by `subject=skill:<name>`. No duplicate storage. |
| Checkpoints (safety doc) | Memory dirs are part of every checkpoint. Rollback restores `index/` and `digests/` together. |

---

## DIRECTORY STRUCTURE - TWO ROOTS

### `~/.pi/agent/` - Pi owns these (we read, do not write)

```
~/.pi/agent/
├── auth.json                        # Pi-managed AI provider credentials
├── settings.json                    # Pi-managed settings
├── sessions/                        # PI'S RAW TRANSCRIPTS (our raw layer)
│   └── <encoded-cwd>/
│       └── <timestamp>_<id>.jsonl   # Append-only, branches/forks/resume
├── skills/                          # PI'S SKILLS DIRECTORY (our toolshed)
│   └── <skill-name>/
│       └── SKILL.md                 # Pi-native + MyPensieve extension frontmatter
├── agents/                          # PI'S AGENTS DIRECTORY (also our council members)
│   ├── orchestrator.md
│   ├── researcher.md
│   ├── critic.md
│   └── intern.md
└── extensions/
    └── mypensieve/                  # MYPENSIEVE'S EXTENSION BUNDLE
        ├── package.json
        ├── memory.ts                # extractor + writer
        ├── projects.ts              # project resolution
        ├── channel-binding.ts       # binding loader
        ├── mcp-client.ts            # MCP integration
        ├── council.ts               # council orchestration via pi-ai
        ├── cost-tracking.ts         # audit log writer
        ├── decision-extractor.ts    # post-session pass
        ├── persona-injector.ts      # injects personas into system prompt
        └── permission-gate.ts       # channel-aware allowlists
```

### `~/.mypensieve/` - MyPensieve owns these

```
~/.mypensieve/
├── config.json                      # read-only at runtime (mode 0444)
├── .secrets/                        # mode 0700, NON-AI secrets only (Telegram bot token, etc.)
├── state/                           # runtime state
├── workspace/
│   ├── identity.md                  # L0
│   └── personas/
│       ├── user.md
│       ├── llm.md
│       ├── pending.md               # contradictions awaiting confirmation
│       └── history/                 # versioned snapshots
├── projects/                        # filesystem-as-registry
│   ├── untagged/                    # default fallback project
│   │   ├── state.md
│   │   ├── decisions.jsonl
│   │   ├── facts.jsonl
│   │   ├── threads.jsonl
│   │   ├── markers.jsonl            # /decide markers from live session
│   │   └── compaction.log
│   ├── <project-1>/
│   └── <project-2>/
├── channels/
│   ├── cli/
│   │   ├── home_code_foo/
│   │   │   └── binding.json
│   │   └── home_code_bar/
│   ├── telegram/
│   │   ├── chat-12345/
│   │   │   └── binding.json
│   │   └── chat-67890/
│   ├── discord/
│   └── api/
├── mcps/                            # MCP server definitions (Pi has no MCP support)
│   ├── _catalog.md
│   ├── telegram/manifest.json
│   ├── github/manifest.json
│   └── ...
├── index/                           # rebuildable derived indexes
│   ├── memory.sqlite                # decisions, threads
│   ├── facts.sqlite                 # bitemporal KG
│   └── embeddings.sqlite            # L4 vector + BM25
├── research/                        # hash-addressed artifacts + council transcripts
│   ├── <hash>.md
│   └── deliberations/
│       └── <deliberation-id>/
│           ├── 01-research.md
│           ├── 02-analysis-orchestrator.md
│           ├── 03-critique.md
│           ├── 04-synthesis.md
│           └── transcript.jsonl
├── digests/
│   ├── weekly/
│   └── monthly/
└── logs/
    ├── errors/
    ├── decisions/
    ├── cost/
    └── audit/                       # bridge audit log (every skill/MCP/provider call)
```

**Key principle:** the two roots are independent. Pi-related state lives in `~/.pi/`. MyPensieve-related state lives in `~/.mypensieve/`. Backup, migration, deletion of one does not corrupt the other. The only place they touch is via Pi's extension API hooks, which is read/event-only from MyPensieve's side.

---

## SUMMARY OF LOCKED DECISIONS

| # | Decision | Choice |
|---|---|---|
| 1 | Distilled storage primitive | Hybrid: JSONL source-of-truth + SQLite derived index |
| 2 | Extractor schedule | Raw live + session-end + nightly cron + manual `extract` |
| 3 | Project boundaries | Channel-bound origination + filesystem registry, no active pointer |
| N1 | Embedding model | Optional, separate config field (not tier-routed). Suggested default: nomic-embed-text via Ollama. L4 disabled cleanly if no embedding configured. |
| N3 | Config layout | Single read-only config.json, secrets separate, init/edit-only writes. Includes providers + routing + overrides sections (see PROVIDERS.md). |

(N2 - the toolshed and skill model - is locked but lives in TOOLSHED-BRIDGE-ARCHITECTURE.md.)
(N4 - provider abstraction and tier_hint routing - is locked but lives in PROVIDERS.md.)
(Agents and council mode are locked but live in MULTI-AGENT-RUNTIME.md.)

---

*Implementation note: when MyPensieve gets built, this doc is the contract. Any deviation must be a new locked decision documented here, not silent drift.*
