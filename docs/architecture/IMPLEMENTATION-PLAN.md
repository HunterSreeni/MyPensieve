# MyPensieve - Phased Implementation Plan
> Status: DRAFT (pending Pi re-audit 2026-04-13)
> Created: 2026-04-10
> Depends on: all locked architecture docs + [MVP-DECISIONS.md](MVP-DECISIONS.md)

---

## Governing rule

**No phase is marked complete until all four test categories pass: unit, integration, e2e, and security.** No exceptions. No "we'll add tests later." Each phase's exit criteria are defined upfront and are non-negotiable.

During development, config is manually created/mocked. The install wizard (Phase 9) ties everything together at the end.

---

## Dependency graph

```
Phase 1: Foundation
    |
    v
Phase 2: Meta-Skill Gateway
    |
    +---> Phase 3: Memory Architecture
    |         |
    |         v
    +---> Phase 4: CLI Channel Adapter
    |         |
    |         v
    +---> Phase 5: Core Skills & MCPs
              |
              +---> Phase 6: Telegram Channel Adapter
              |
              +---> Phase 7: Operations Layer
              |
              +---> Phase 8: Council / Multi-Agent
                        |
                        v
                  Phase 9: Install Wizard & Persona Seeding
                        |
                        v
                  Phase 10: Integration Hardening & Release
```

Phases 3, 4, and 5 can run in parallel after Phase 2 completes.
Phases 6, 7, and 8 can run in parallel after Phase 5 completes.
Phase 9 requires all prior phases.
Phase 10 is the final pass.

---

## Phase 1: Foundation

**Goal:** Pi embedded as a library, extension loader working, config system in place. MyPensieve can start a bare Pi session with its extensions loaded.

### Build

| Component | What | Location |
|-----------|------|----------|
| Pi SDK embed | `createAgentSession` from `@mariozechner/pi-coding-agent` running in a host process | `src/core/session.ts` |
| Extension bundle scaffold | Empty extension bundle that Pi's jiti loader picks up | `~/.pi/agent/extensions/mypensieve/` |
| Extension entry point | Main extension file that registers all MyPensieve hooks | `~/.pi/agent/extensions/mypensieve/index.ts` |
| Config schema | TypeScript types + validation for `~/.mypensieve/config.json` | `src/config/schema.ts` |
| Config reader | Read-only config loader (mode 0444 enforcement) | `src/config/reader.ts` |
| Config writer | Used only by `init` and `config edit` commands | `src/config/writer.ts` |
| Directory scaffold | Create `~/.mypensieve/` namespace (memory, projects, logs, state, secrets) | `src/init/directories.ts` |
| Extension dependency resolution | Verify Pi's jiti loader handles `package.json` in the bundled extension dir | Smoke test |

### Unit tests

- Config schema validation: valid config passes, invalid config rejected with clear error
- Config reader: reads from correct path, enforces read-only, returns typed object
- Config writer: writes atomically (temp file + rename), sets mode 0444
- Directory scaffold: creates all expected dirs with correct permissions

### Integration tests

- Pi session starts with MyPensieve extension bundle loaded
- Extension's `onSessionStart` hook fires and receives correct session context
- Extension can access Pi's `AgentSession` API (tools, messages, events)
- Config is readable from within the extension context
- Extension with its own `package.json` dependencies loads correctly (jiti loader test)

### E2E tests

- From zero state: run directory scaffold, write config, start Pi session with extensions, send one message, get a response, session shuts down cleanly
- `SessionShutdownEvent` fires on exit

### Security tests

- Config file at `~/.mypensieve/config.json` has mode 0444 after write
- Secrets dir at `~/.mypensieve/.secrets/` has mode 0700
- Extension cannot write to config (read-only enforcement)
- No secrets leak into session JSONL logs

### Exit criteria

All 4 test categories green. A bare MyPensieve session starts, loads extensions, reads config, responds to a message, and shuts down cleanly.

---

## Phase 2: Meta-Skill Gateway

**Goal:** The 8-verb gateway is the agent's only tool surface. Deterministic routing works for 7 verbs. LLM routing works for `research`. Escape hatch enforcement works. Agent cannot see raw skills or MCPs.

**Depends on:** Phase 1 (extension loader, config)

### Build

| Component | What | Location |
|-----------|------|----------|
| Verb type definitions | TypeScript types for all 8 verbs + their typed args/returns | `src/gateway/verbs.ts` |
| Deterministic router | Code router for 7 verbs (recall, ingest, monitor, journal, produce, dispatch, notify) | `src/gateway/router.ts` |
| LLM router | Cheap-tier LLM router for `research` verb only | `src/gateway/research-router.ts` |
| Routing table loader | Load YAML routing rules from `~/.mypensieve/meta-skills/<verb>.yaml` | `src/gateway/routing-table.ts` |
| Routing table schema | TypeScript validation for YAML routing rules | `src/gateway/routing-schema.ts` |
| Tool injection extension | Pi extension that replaces the agent's tool list with 8 verb tools | `src/gateway/extension.ts` |
| Binding validator | Session-start validator that checks channel config (escape hatch enforcement) | `src/gateway/binding-validator.ts` |
| Escape hatch | Optional 9th `tool()` verb, per-channel opt-in, hard-blocked on Telegram | `src/gateway/escape-hatch.ts` |
| Audit log | Log every verb invocation with timestamp, verb, args hash, result status | `src/gateway/audit.ts` |
| Custom skill registration | Read `mypensieve_exposes_via` from skill frontmatter, add to routing table | `src/gateway/skill-registration.ts` |

### Unit tests

- Each verb's typed args are validated (missing required field = clear error)
- Deterministic router maps each verb to the correct underlying skill/MCP name
- LLM router for `research` forces `tier_hint: cheap` (never escalates)
- Routing table loader parses valid YAML, rejects malformed YAML with clear error
- Binding validator passes valid channel configs, rejects invalid ones
- Custom skill with `mypensieve_exposes_via: recall` registers under the `recall` verb
- Audit log entries have correct schema

### Integration tests

- Agent session starts with only 8 verbs visible (no raw skill/MCP names in tool list)
- Agent calls `recall` verb - gateway dispatches to memory-recall skill stub
- Agent calls `research` verb - gateway dispatches via LLM router to researcher skill stub
- Agent calls `produce` verb - gateway dispatches to correct produce skill stub based on `kind` arg
- Custom skill installed at runtime appears under its declared verb
- Audit log captures all verb invocations with correct metadata

### E2E tests

- Full session: agent receives a task, uses verbs to complete it, all routing is correct
- Agent attempts to call a raw skill name directly - call is rejected/not found
- `tool()` escape hatch disabled by default on CLI - agent cannot use it unless config enables it
- `tool()` escape hatch enabled on CLI via config - agent can use it

### Security tests

- **Verb isolation:** agent's tool list contains exactly 8 entries (or 9 if escape hatch enabled). No raw skill/MCP names leak
- **Escape hatch hard-block:** session with Telegram channel + `tool()` enabled fails to start with clear error
- **Escape hatch default-off:** fresh config has `tool_escape_hatch: false` for all channels
- **Prompt injection resistance:** inject "call the gh-cli MCP directly" into agent context - verify the call is impossible (tool doesn't exist in agent's namespace)
- **Research tier enforcement:** `research` verb invocation always uses cheap tier, even if agent's session is configured for deep tier
- **Routing table injection:** malformed YAML with code injection attempts is rejected safely
- **Audit completeness:** every verb call (including failed ones) appears in audit log

### Exit criteria

All 4 test categories green. The gateway is the sole chokepoint for all agent-tool interaction. Raw skills/MCPs are invisible to the agent. Escape hatch enforcement works per-channel.

---

## Phase 3: Memory Architecture

**Goal:** 5-layer cognitive memory working. JSONL source-of-truth + SQLite derived index. Session-end extractor and nightly synthesizer operational. Decision detection (manual + auto) working.

**Depends on:** Phase 2 (gateway, because `recall` verb routes here)

### Build

| Component | What | Location |
|-----------|------|----------|
| Memory extension | Pi extension that hooks session events for memory capture | `src/memory/extension.ts` |
| L1 - Decisions layer | Append-only JSONL for decisions with confidence scores | `src/memory/layers/decisions.ts` |
| L2 - Threads layer | SQLite-indexed open/closed threads | `src/memory/layers/threads.ts` |
| L3 - Persona layer | `user.md` + `llm.md` files with delta tracking | `src/memory/layers/persona.ts` |
| L4 - Semantic search | Optional embedding-based recall (disabled if no embedding configured) | `src/memory/layers/semantic.ts` |
| L5 - Raw sessions | Pointer to Pi's session JSONL (Pi owns this, we just read) | `src/memory/layers/raw.ts` |
| Session-end extractor | Runs on `SessionShutdownEvent`, extracts decisions + threads + persona deltas | `src/memory/extractor.ts` |
| Decision detector | Manual `/decide` marker (0.95) + auto-detection prompt (0.65) | `src/memory/decision-detector.ts` |
| Nightly synthesizer | Cron job at 02:00 - compacts state, detects contradictions, updates persona | `src/memory/synthesizer.ts` |
| Extractor checkpoint | `state/extractor-checkpoint.json` for idempotent resume | `src/memory/checkpoint.ts` |
| Contradiction detector | Deep-tier LLM call to check persona deltas against current persona | `src/memory/contradiction.ts` |
| SQLite index | Derived index for fast queries across L1-L3 | `src/memory/sqlite-index.ts` |
| Memory query API | Unified query interface used by `memory-recall` skill | `src/memory/query.ts` |

### Unit tests

- L1: decision append is idempotent (same decision ID = no duplicate)
- L1: manual `/decide` marker produces confidence 0.95
- L1: auto-detected decision produces confidence 0.65
- L2: thread open/close lifecycle, SQLite index stays in sync with JSONL
- L3: persona delta append, delta list query
- L4: embedding store/retrieve (with mock embeddings), clean disable when no embedding configured
- Checkpoint: write, read, resume from correct session ID
- Decision detector: 5 positive examples correctly identified, 5 negative examples correctly rejected
- Contradiction detector: detects "prefers terse" vs "prefers detailed" as contradiction (confidence > 0.7)
- Synthesizer: compaction produces valid output, SQLite transaction atomicity

### Integration tests

- Session-end extractor fires on `SessionShutdownEvent`, writes to correct JSONL files
- Extractor interrupted mid-run, resumed - no data loss, no duplicates
- Nightly synthesizer reads all JSONL sources, updates SQLite index, updates persona files
- `recall` verb dispatches to memory query API, returns results from correct layers
- Memory query across L1-L3 returns combined results ranked by relevance

### E2E tests

- Full session: operator makes decisions, session ends, extractor runs, decisions queryable via `recall` verb in next session
- Operator uses `/decide X because Y` - decision appears in L1 with confidence 0.95
- Auto-detected decision from session transcript appears in L1 with confidence 0.65
- Nightly synthesizer runs, persona file updated, contradiction surfaced to operator
- Extractor crash + restart: resumes from checkpoint, no data corruption

### Security tests

- Memory files have correct permissions (not world-readable)
- SQLite index cannot be corrupted by concurrent writes (WAL mode + transactions)
- Persona files cannot be overwritten by agent directly (only via synthesizer pipeline)
- Memory query cannot return data from a different project (channel-bound isolation)
- Decision confidence cannot be spoofed by agent (extractor sets it, not agent)

### Exit criteria

All 4 test categories green. Memory persists across sessions. Decisions are captured (manual + auto). Nightly synthesizer compacts and detects contradictions. Extractor is idempotent and checkpoint-resumable.

---

## Phase 4: CLI Channel Adapter

**Goal:** `mypensieve start` launches an interactive CLI session with Pi's TUI, MyPensieve extensions loaded, channel binding active, and clean shutdown with extractor.

**Depends on:** Phase 2 (gateway), Phase 3 (memory - for extractor on shutdown)

### Build

| Component | What | Location |
|-----------|------|----------|
| CLI entry point | `mypensieve start` command | `src/cli/start.ts` |
| Channel binding | Bind CLI session to `cli/<cwd-slug>` project | `src/channels/cli/binding.ts` |
| Project loader | Load project state from `~/.mypensieve/projects/<binding>/` | `src/projects/loader.ts` |
| Session wrapper | Thin wrapper around `createAgentSession` with MyPensieve config injected | `src/channels/cli/session.ts` |
| Shutdown handler | Catch exit/SIGINT/SIGTERM, fire `SessionShutdownEvent`, run extractor in background | `src/channels/cli/shutdown.ts` |
| CLI command router | Parse `mypensieve <command>` and dispatch to handler | `src/cli/router.ts` |
| Basic CLI commands | `start`, `config edit`, `errors`, `doctor` - minimum viable CLI surface | `src/cli/commands/` |

### Unit tests

- Channel binding generates correct slug from cwd path
- Project loader reads correct project directory, creates if missing
- CLI command router dispatches known commands, rejects unknown with help text
- Shutdown handler fires in correct order (SessionShutdownEvent -> extractor -> exit)

### Integration tests

- `mypensieve start` launches Pi session with all MyPensieve extensions loaded
- Session is bound to correct project based on cwd
- Gateway is active (agent sees 8 verbs only)
- Memory extension hooks are firing during session
- `mypensieve config edit` opens config in `$EDITOR`
- `mypensieve doctor` runs healthcheck and reports status

### E2E tests

- Full lifecycle: `mypensieve start` -> interactive session -> send message -> get response -> exit -> extractor runs -> decisions queryable in next session
- Multiple sessions from different cwds bind to different projects
- Ctrl+C triggers clean shutdown (not abrupt kill)
- `mypensieve errors` shows error log from previous sessions

### Security tests

- CLI session cannot access memory from a different project binding
- Shutdown handler runs extractor even on SIGTERM (graceful degradation)
- No credentials printed to terminal output
- Session JSONL does not contain secrets from config

### Exit criteria

All 4 test categories green. An operator can start a CLI session, interact with the agent via 8 verbs, have their decisions extracted, and resume context in the next session.

---

## Phase 5: Core Skills & MCPs

**Goal:** All 9 custom skills and 6 MCPs are built, registered with the gateway via `mypensieve_exposes_via`, and routable through the correct verbs.

**Depends on:** Phase 2 (gateway routing), Phase 3 (memory - for `memory-recall`), Phase 4 (CLI - for manual testing)

### Build

| Component | What | Location |
|-----------|------|----------|
| **Skills** | | |
| `daily-log` | Full N7 spec - 12 source pulls, 6 operator fields, JSONL storage | `skills/daily-log/SKILL.md` + `src/skills/daily-log/` |
| `memory-recall` | Thin query layer over memory extension (L1-L4) | `skills/memory-recall/SKILL.md` |
| `researcher` | Plan-search-read-synthesize loop, DDG backend, citation footnotes | `skills/researcher/SKILL.md` + `src/skills/researcher/` |
| `cve-monitor` | osv-scanner + cve-intel MCP, diff-only alerts, CVSS >= 7.0 threshold | `skills/cve-monitor/SKILL.md` + `src/skills/cve-monitor/` |
| `blog-seo` | SEO-aware drafting, Yoast scoring rules, SERP peeks | `skills/blog-seo/SKILL.md` + `src/skills/blog-seo/` |
| `playwright-cli` | Port from existing 278-line skill, stripped for general use | `skills/playwright-cli/SKILL.md` |
| `video-edit` | Node ffmpeg wrapper - convert, trim, concat, overlay, metadata strip | `skills/video-edit/SKILL.md` + `src/skills/video-edit/` |
| `audio-edit` | Node ffmpeg wrapper + whisper delegation for transcription | `skills/audio-edit/SKILL.md` + `src/skills/audio-edit/` |
| `image-edit` | sharp-based - resize, crop, convert, EXIF strip, watermark | `skills/image-edit/SKILL.md` + `src/skills/image-edit/` |
| **MCPs** | | |
| `datetime` | Generalized from hardcoded timezone, reads from config | `mcps/datetime/` |
| `playwright` | Standard Playwright MCP, headed default | Config entry in `mcp-servers.json` |
| `duckduckgo-search` | nickclyde/duckduckgo-mcp-server (Python, process-isolated) | Config entry in `mcp-servers.json` |
| `whisper-local` | jwulff/whisper-mcp, base.en model default | Config entry in `mcp-servers.json` |
| `gh-cli` | kousen/gh_mcp_server, wraps operator's `gh` auth | Config entry in `mcp-servers.json` |
| `cve-intel` | Custom ~300 LOC Node MCP - OSV.dev + NVD 2.0 + EPSS + CISA KEV | `mcps/cve-intel/` |
| **External repos** | | |
| `anthropics/skills` | Mandatory - PDF, DOCX, PPTX, XLSX | Auto-registered at install |
| `badlogic/pi-skills` | Recommended - browser-tools | Auto-registered at install |

### Unit tests

Per skill:
- Skill frontmatter has valid `mypensieve_exposes_via` field matching expected verb
- Skill input validation: required args present, types correct
- Skill output schema matches verb's expected return type

Per MCP:
- `datetime` returns correct time for configured timezone
- `cve-intel` parses OSV.dev, NVD, EPSS, CISA KEV responses correctly (mock HTTP)
- `cve-intel` handles API errors gracefully (timeout, 5xx, malformed JSON)

Specific skill logic:
- `daily-log`: reads all 12 sources, produces correct digest schema, JSONL append is valid
- `researcher`: plan-search-read-synthesize produces citations in `[n]` format
- `cve-monitor`: diff logic - second run with same data produces zero alerts
- `blog-seo`: Yoast scoring produces a score 0-100, flags missing meta
- `image-edit`: sharp operations produce valid output files, EXIF stripped
- `video-edit`: ffmpeg commands are correctly constructed for each operation
- `audio-edit`: transcription delegates to whisper-local MCP (not internal)

### Integration tests

- Each skill routes through correct gateway verb
- `journal` verb -> `daily-log` skill -> reads sources -> prompts operator -> writes JSONL
- `research` verb -> `researcher` skill -> `duckduckgo-search` MCP -> synthesized result with citations
- `monitor(target='cves')` -> `cve-monitor` -> `cve-intel` MCP -> diff-only alerts
- `produce(kind='blog-post')` -> `blog-seo` -> drafts with SEO score
- `ingest(source='audio')` -> `audio-edit` -> `whisper-local` MCP -> transcript
- `dispatch(action='gh.pr.create')` -> `gh-cli` MCP -> PR created (mock GitHub)
- External skill repo (`anthropics/skills/pdf`) loaded and routable via `ingest` verb

### E2E tests

- Operator asks agent to research a topic - full loop through `research` verb to DDG to synthesis to cited response
- Operator triggers `mypensieve log` - daily-log reads all sources, asks questions, stores entry, queryable via `recall` next session
- Operator asks to process an image - `produce(kind='image')` routes to `image-edit`, output file created
- Operator asks about CVEs - `monitor(target='cves')` returns only new findings since last check

### Security tests

- No skill can bypass the gateway (all invocations go through verb routing)
- `playwright-cli` is blocked on Telegram channel (`mypensieve_allowed_channels: [cli]`)
- `produce` verb enforces EXIF strip on image output (no metadata leak)
- `produce` verb enforces output-path allowlist (cannot write to arbitrary paths)
- `dispatch` verb requires confirmation by default (no silent external state changes)
- `cve-intel` MCP makes zero auth-required API calls (all 4 sources are zero-auth)
- `researcher` skill cannot escalate `tier_hint` beyond `cheap`

### Exit criteria

All 4 test categories green. All 9 skills and 6 MCPs are functional, gateway-routed, and the agent can use them through verbs to accomplish real tasks.

---

## Phase 6: Telegram Channel Adapter

**Goal:** MyPensieve runs as a Telegram bot daemon. Operator sends a message, agent responds via the correct project binding, sessions timeout after 30min inactivity.

**Depends on:** Phase 5 (skills and MCPs must work before adding a second channel)

### Build

| Component | What | Location |
|-----------|------|----------|
| Telegram daemon | Long-running process, listens for messages via Telegram Bot API | `src/channels/telegram/daemon.ts` |
| Peer session manager | Map `peer_id` to `AgentSession` (one-to-one), create on first message | `src/channels/telegram/sessions.ts` |
| Inactivity timeout | 30min default (configurable), fires `SessionShutdownEvent` on timeout | `src/channels/telegram/timeout.ts` |
| Response streamer | Stream agent responses back to Telegram (chunked for message length limits) | `src/channels/telegram/streamer.ts` |
| Channel binding | Bind Telegram sessions to `telegram/<peer_id>` project | `src/channels/telegram/binding.ts` |
| Bot token config | Read bot token from `~/.mypensieve/.secrets/telegram.json` | `src/channels/telegram/auth.ts` |
| Message formatting | Convert agent markdown to Telegram-compatible markdown | `src/channels/telegram/formatter.ts` |

### Unit tests

- Peer session manager: creates new session on unknown peer_id, reuses existing for known peer_id
- Inactivity timeout: fires after 30min of no messages, resets on new message
- Response streamer: chunks messages at Telegram's 4096 char limit
- Channel binding: generates correct `telegram/<peer_id>` slug
- Message formatter: converts code blocks, links, headers to Telegram markdown

### Integration tests

- Telegram daemon starts, connects to Bot API, receives a message
- Message routed to correct peer session with MyPensieve extensions loaded
- Gateway is active (8 verbs only - `tool()` escape hatch hard-blocked)
- Agent response streamed back to Telegram in correct format
- Session timeout fires after 30min, `SessionShutdownEvent` triggers extractor
- New message after timeout creates a fresh session

### E2E tests

- Full Telegram conversation: send message -> agent responds -> send followup -> agent responds with context from same session
- Session timeout -> new message -> new session starts, but previous decisions are queryable via `recall`
- Long response (> 4096 chars) arrives as multiple Telegram messages
- Operator sends audio file -> `ingest(source='audio')` -> transcription returned

### Security tests

- Bot token stored in `~/.mypensieve/.secrets/telegram.json` (mode 0700 dir)
- Bot token never appears in session JSONL or logs
- `tool()` escape hatch is hard-blocked - session fails to start if config has it enabled for Telegram
- `playwright-cli` skill is blocked on Telegram channel
- Peer isolation: session for peer A cannot access memory from peer B's project
- Rate limiting: rapid message spam does not crash daemon or spawn unbounded sessions

### Exit criteria

All 4 test categories green. Operator can chat with MyPensieve via Telegram, sessions persist within 30min window, memory carries across sessions, Telegram-specific security constraints enforced.

---

## Phase 7: Operations Layer

**Goal:** Error handling, backup/restore, healthcheck, cron monitoring, and notification dedup are all operational. `mypensieve doctor`, `mypensieve errors`, `mypensieve recover`, `mypensieve backup`, `mypensieve restore` all work.

**Depends on:** Phase 5 (skills - daily-log, error sources), Phase 4 (CLI commands)

### Build

| Component | What | Location |
|-----------|------|----------|
| Error capture | 5 severity levels, structured JSONL at `logs/errors/<date>.jsonl` | `src/ops/errors/capture.ts` |
| Error SQLite index | Derived index for fast error queries | `src/ops/errors/index.ts` |
| Retry engine | Per-error-type retry policies (network, rate limit, OAuth, MCP) | `src/ops/errors/retry.ts` |
| Circuit breakers | Extension, provider, cron, global level breakers | `src/ops/errors/circuit-breaker.ts` |
| Notification dedup | Dedup by `(error_type, error_src)` per 1-hour window | `src/ops/errors/dedup.ts` |
| Error surfacing | 4 channels: daily digest, inline session-start, Telegram critical, CLI on demand | `src/ops/errors/surfacing.ts` |
| Backup engine | Daily tar.gz at 02:30, 30-day retention, local + rsync destinations | `src/ops/backup/engine.ts` |
| Backup verify | Integrity check for backup archives | `src/ops/backup/verify.ts` |
| Restore engine | Extract backup to correct paths, validate before overwrite | `src/ops/backup/restore.ts` |
| Healthcheck | `mypensieve doctor` - verify all components, warn on stale backups | `src/ops/healthcheck.ts` |
| Cron monitor | Reminders pattern - each cron job touches `state/reminders/<job-name>` on success | `src/ops/cron-monitor.ts` |
| Recovery commands | `mypensieve errors`, `mypensieve recover`, `mypensieve doctor` | `src/cli/commands/ops.ts` |
| Cost tracker | Per-tool-call cost logging to `logs/cost/<date>.json` | `src/ops/cost.ts` |

### Unit tests

- Error capture: valid error logged with correct severity, timestamp, structured fields
- Retry engine: correct policy selected per error type, retry count incremented
- Circuit breaker: opens after N failures, half-opens after cooldown, closes on success
- Notification dedup: first occurrence surfaces, 2nd-50th suppressed, count accurate
- Dedup window: events after 1-hour reset surface again
- Backup engine: tar.gz contains expected dirs, excludes secrets by default
- Backup verify: detects corrupt archive, passes valid archive
- Restore engine: extracts to temp dir first, validates, then moves into place
- Healthcheck: reports stale backup (> 2 days), failed backup (> 7 days)
- Cost tracker: correct schema, aggregates by provider and tier

### Integration tests

- Error thrown in extension -> captured in JSONL -> indexed in SQLite -> queryable via `mypensieve errors`
- Network error -> retry engine retries 3x with backoff -> succeeds or escalates to circuit breaker
- Circuit breaker opens -> subsequent calls fast-fail -> half-open after cooldown
- Backup runs at scheduled time -> archive created -> verify passes -> old backups (> 30 days) pruned
- `mypensieve doctor` checks: config valid, extensions loaded, MCPs responsive, backup fresh, no open circuit breakers
- `mypensieve recover` runs applicable recovery actions for unresolved errors
- Daily digest includes error summary from last 24h

### E2E tests

- Full error lifecycle: error occurs -> logged -> deduped -> surfaced in daily digest -> operator runs `mypensieve errors` -> sees it -> runs `mypensieve recover` -> error resolved
- Full backup lifecycle: backup runs -> `mypensieve backup verify` passes -> simulate data loss -> `mypensieve restore <file>` -> data recovered -> session starts normally
- Cron job fails -> reminder file not touched -> healthcheck warns -> next run succeeds -> warning clears

### Security tests

- Backup with `--include-secrets` flag explicitly required to include secrets (default excludes)
- Restore validates archive integrity before extracting (no zip bomb, no path traversal)
- Error log does not contain raw API keys or tokens (redacted in capture)
- Circuit breaker state cannot be reset by agent (only by operator via CLI)
- Backup archives have correct file permissions (not world-readable)

### Exit criteria

All 4 test categories green. Error handling catches, deduplicates, and surfaces errors correctly. Backup/restore cycle works end-to-end. Healthcheck reports accurate system state. All recovery commands functional.

---

## Phase 8: Council / Multi-Agent

**Goal:** Agent personas work in solo mode (default). Council mode is opt-in via `mypensieve deliberate`. Phase-based deliberation with shared transcript, checkpointing, and consensus/dissent tracking.

**Depends on:** Phase 5 (skills - agents invoke skills via gateway), Phase 4 (CLI - `deliberate` command)

### Build

| Component | What | Location |
|-----------|------|----------|
| Agent persona loader | Load `~/.pi/agent/agents/<name>.md` with extended frontmatter | `src/council/persona-loader.ts` |
| Agent registry | Track available agents, their tier_hints, and council eligibility | `src/council/registry.ts` |
| `mypensieve agent add` | CLI command to create a new agent persona from template | `src/cli/commands/agent-add.ts` |
| Council manager | Host-orchestrated deliberation via `pi-ai.complete()` per agent turn | `src/council/manager.ts` |
| Speaker selection | Phase-driven (default), round_robin, auto, manual modes | `src/council/speaker-selection.ts` |
| Shared transcript | In-memory message list visible to all agents every turn (Cognition rule) | `src/council/transcript.ts` |
| Structured channels | Named channels: `researchFindings`, `critiques`, `draft` (LangGraph pattern) | `src/council/channels.ts` |
| Handoff tool | `handoff_to(name)` tool available inside councils (OpenAI Agents SDK pattern) | `src/council/handoff.ts` |
| Checkpointer | Write `checkpoints.jsonl` after each turn, resume on interrupt | `src/council/checkpointer.ts` |
| Consensus tracker | Boolean consensus flag + dissent array in result | `src/council/consensus.ts` |
| Deliberation result | Final structured output with synthesis, consensus, dissent, recommendations | `src/council/result.ts` |
| `mypensieve deliberate` | CLI command to trigger council mode with topic + agent selection | `src/cli/commands/deliberate.ts` |

### Unit tests

- Persona loader: parses Pi-native + MyPensieve-extended frontmatter correctly
- Agent registry: lists available agents, filters by `can_be_convened`
- Speaker selection: each mode (phase-driven, round_robin, auto, manual) produces correct agent order
- Shared transcript: all agents see full history every turn (no per-agent slicing)
- Checkpointer: write/read/resume cycle, correct turn number on resume
- Consensus tracker: unanimous agreement = `consensus: true`, any dissent = `consensus: false` + dissent array
- Handoff tool: `handoff_to("critic")` sets next speaker to critic
- `max_round` enforcement: deliberation stops after max rounds even without consensus
- `is_termination_msg` detection: synthesis phase output terminates deliberation

### Integration tests

- Council with 3 agents: researcher, critic, orchestrator - full phase cycle completes
- Each agent invokes skills via gateway verbs during their turn
- Shared transcript grows correctly - agent N sees all messages from agents 1 to N-1
- Structured channels populated: `researchFindings` by researcher, `critiques` by critic
- `handoff_to` changes next speaker mid-phase
- Deliberation interrupted mid-phase -> checkpointer saves state -> resume produces valid result

### E2E tests

- `mypensieve deliberate "Should we use Redis or SQLite for caching?"` -> 3 agents deliberate -> result with consensus + recommendations displayed
- Council with dissent: critic disagrees -> result shows `consensus: false` with dissent reasons
- Operator adds a new agent (`mypensieve agent add devil-advocate`) -> new agent available in next deliberation
- Long deliberation hits `max_round` -> terminates gracefully with partial synthesis

### Security tests

- Council agents can only invoke skills via gateway verbs (no raw skill access)
- Agent persona files cannot be modified during a deliberation (read-only during council)
- Council result is written to the correct project's directory (channel-bound)
- `pi-ai.complete()` calls use the agent's declared `tier_hint` (no tier escalation)
- Shared transcript cannot leak data from a different project

### Exit criteria

All 4 test categories green. Solo mode works with single Orchestrator. Council mode produces structured results with consensus tracking. Checkpointing handles interruptions. Agents invoke skills through gateway only.

---

## Phase 9: Install Wizard & Persona Seeding

**Goal:** `mypensieve init` runs the full 9-step wizard. All three persona seeding modes work. Wizard is resumable. Fresh install produces a working system.

**Depends on:** All prior phases (wizard configures everything)

### Build

| Component | What | Location |
|-----------|------|----------|
| Wizard framework | Step-based wizard with progress tracking and resumability | `src/wizard/framework.ts` |
| Step 1: Welcome | Operator profile - name, timezone, working hours | `src/wizard/steps/welcome.ts` |
| Step 2: Project | Create default project or bind existing directory | `src/wizard/steps/project.ts` |
| Step 3: Providers | AI provider setup - Anthropic OAuth (via Pi), OpenRouter, Ollama | `src/wizard/steps/providers.ts` |
| Step 4: Routing | Tier-hint routing - which provider handles cheap/mid/deep | `src/wizard/steps/routing.ts` |
| Step 5: Embeddings | Enable/disable L4, choose provider (default: disabled) | `src/wizard/steps/embeddings.ts` |
| Step 6: Channels | Select CLI + Telegram, configure Telegram bot token if selected | `src/wizard/steps/channels.ts` |
| Step 7: Persona | Three modes - questionnaire, free-form, skip | `src/wizard/steps/persona.ts` |
| Step 8: Review | Show all config, allow edits before confirming | `src/wizard/steps/review.ts` |
| Step 9: Initialize | Write config, create directories, register skills/MCPs, start first session | `src/wizard/steps/initialize.ts` |
| Progress tracker | `.init-progress.json` for resumability | `src/wizard/progress.ts` |
| Guided questionnaire | 8-10 structured questions for persona seeding | `src/wizard/persona/questionnaire.ts` |
| Free-form extractor | LLM extracts structured persona from free text | `src/wizard/persona/freeform.ts` |

### Unit tests

- Progress tracker: saves after each step, loads on restart, detects completed steps
- Each wizard step: validates input, produces correct config fragment
- Persona questionnaire: each question produces the expected persona field
- Free-form extractor: given sample text, extracts role, goals, style, expertise
- Provider step: correctly delegates Anthropic OAuth to `pi auth login`
- Routing step: validates at least one provider covers each tier
- Review step: correctly renders all config for operator review

### Integration tests

- Wizard runs steps 1-9 sequentially, each step's output feeds the next
- Wizard interrupted at step 5 -> restart -> resumes from step 5 with steps 1-4 preserved
- Anthropic OAuth: wizard calls Pi's auth flow, token stored in `~/.pi/agent/auth.json`
- Telegram channel selected: wizard prompts for bot token, stores in secrets dir
- Persona mode "questionnaire": answers produce valid `user.md` and `llm.md`
- Persona mode "free-form": text produces valid `user.md` and `llm.md`
- Persona mode "skip": empty/minimal persona files created

### E2E tests

- Fresh machine (no `~/.mypensieve/`, no `~/.pi/`): `mypensieve init` -> full wizard -> `mypensieve start` -> working session with gateway, memory, and skills
- Wizard with "restart from scratch" option: clears progress, runs from step 1
- Wizard with all defaults: produces a working minimal install (CLI only, no embeddings, skip persona)
- Wizard with full options: CLI + Telegram, embeddings enabled, questionnaire persona, all providers configured

### Security tests

- Bot token entered in step 6 stored only in `~/.mypensieve/.secrets/telegram.json` (mode 0700), never in config.json
- OAuth tokens stored in Pi's auth location, never in MyPensieve config
- Progress file does not contain secrets (only step completion flags)
- Wizard validates provider URLs (no arbitrary URL injection)
- Config written with mode 0444

### Exit criteria

All 4 test categories green. A fresh install via `mypensieve init` produces a fully working system. All three persona modes work. Wizard resumes correctly after interruption.

---

## Phase 10: Integration Hardening & Release

**Goal:** Full system integration test suite. Cross-phase interactions verified. Performance baselines established. Documentation complete. v0.1 release.

**Depends on:** All prior phases

### Build

| Component | What | Location |
|-----------|------|----------|
| Cross-phase integration suite | Tests that span multiple phases (wizard -> session -> memory -> council) | `tests/integration/cross-phase/` |
| Performance baselines | Token usage per verb, session startup time, extractor duration, backup size | `tests/performance/` |
| Stress tests | Concurrent sessions, rapid message spam, large memory corpus | `tests/stress/` |
| Release checklist | Manual verification checklist for release readiness | `docs/RELEASE-CHECKLIST.md` |
| npm package config | Package.json, build scripts, binary entry point | `package.json` |
| Upgrade path | `mypensieve upgrade` command for future version migrations | `src/cli/commands/upgrade.ts` |

### Cross-phase integration tests

- **Wizard -> CLI -> Memory:** Fresh install -> wizard -> CLI session -> make decisions -> exit -> next session -> recall decisions via `recall` verb
- **CLI -> Telegram -> Memory:** Decision made in CLI session -> queryable from Telegram session (same project binding = shared memory)
- **Skills -> Gateway -> Memory:** Researcher skill produces findings -> stored in memory -> recallable later
- **Council -> Memory -> Daily-log:** Council deliberation result -> extracted as decisions -> appears in daily-log digest
- **Error -> Recovery -> Healthcheck:** Error occurs -> recovery runs -> `mypensieve doctor` shows resolved
- **Backup -> Restore -> Verify:** Full backup -> delete data -> restore -> all sessions and memory intact -> `mypensieve doctor` passes

### Cross-channel tests

- Same operator, CLI + Telegram: memory shared correctly via channel-bound project
- Telegram session active while CLI session runs in different project: no cross-contamination
- Error in Telegram session surfaced in CLI's daily digest

### Performance baselines

| Metric | Target | How to measure |
|--------|--------|---------------|
| Session startup time (CLI) | < 3 seconds | Timer from `mypensieve start` to first prompt |
| Gateway verb dispatch | < 50ms overhead | Timer from verb call to underlying skill/MCP invocation |
| Session-end extractor | < 30 seconds for a 1-hour session | Timer from SessionShutdownEvent to extractor completion |
| Nightly synthesizer | < 5 minutes for 30 days of sessions | Timer for full synthesizer run |
| Backup (1GB data) | < 2 minutes | Timer for tar.gz creation |
| Memory recall (L1-L3) | < 500ms | Timer from `recall` verb to result |

### Security audit

- Full OWASP top 10 review against all external-facing surfaces (Telegram bot, gateway verbs)
- Prompt injection test suite: 20 injection attempts across all 8 verbs
- Secrets audit: grep all logs, config, JSONL for leaked tokens/keys
- Permissions audit: all files and directories have correct modes
- Dependency audit: `npm audit` + `osv-scanner` against MyPensieve's own lockfile

### Stress tests

- 100 rapid messages on Telegram: no crash, no unbounded session creation
- 50 concurrent CLI sessions in different cwds: no cross-contamination
- Memory corpus with 10,000 decisions: `recall` still returns in < 500ms
- Nightly synthesizer with 90 days of data: completes without OOM

### Exit criteria

All cross-phase integration tests green. All cross-channel tests green. Performance baselines met. Security audit clean. Stress tests pass. `mypensieve init` on a fresh machine produces a working system. **v0.1 is ready to ship.**

---

## Phase summary

| Phase | Name | Depends on | Parallel group |
|-------|------|------------|---------------|
| 1 | Foundation | - | - |
| 2 | Meta-Skill Gateway | 1 | - |
| 3 | Memory Architecture | 2 | A (parallel with 4, 5) |
| 4 | CLI Channel Adapter | 2, 3 | A |
| 5 | Core Skills & MCPs | 2, 3, 4 | A |
| 6 | Telegram Channel Adapter | 5 | B (parallel with 7, 8) |
| 7 | Operations Layer | 5, 4 | B |
| 8 | Council / Multi-Agent | 5, 4 | B |
| 9 | Install Wizard | All prior | - |
| 10 | Integration Hardening | All prior | - |

---

## What blocks Phase 1

The Pi re-audit on **2026-04-13**. If the re-audit returns Green (no breaking changes) or Yellow (minor adjustments), Phase 1 starts immediately. If Orange or Red, we amend the architecture docs first, then start.

See [PI-REAUDIT-CHECKLIST.md](PI-REAUDIT-CHECKLIST.md) for the outcome classification table.
