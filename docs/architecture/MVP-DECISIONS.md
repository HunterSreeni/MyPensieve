# MVP-DECISIONS.md
> Full decision list for MyPensieve MVP. Covers install wizard, session lifecycle, persona seeding, OAuth, memory extraction, council, error handling, meta-skill gateway, skills, and CLI surface.
>
> **Locked: 2026-04-10.**

---

## Implementation philosophy

**No phase ships without passing all four test categories: unit, integration, e2e, and security tests.** A phase is "complete" only when all four are green. No exceptions.

Each phase follows this structure:

```
Phase N: [Name]
  Build: what gets implemented
  Unit tests: isolated function/module tests
  Integration tests: components working together
  E2E tests: full user-flow validation
  Security tests: attack surface, injection, permission boundaries
  Exit criteria: all 4 green = phase complete
```

---

## A. Install Wizard

### A1. Wizard flow (9 steps)

| Step | What happens |
|------|-------------|
| 1 | Welcome + operator profile (name, timezone, working hours) |
| 2 | Create default project or bind to existing directory |
| 3 | AI Provider setup (Anthropic OAuth, OpenRouter key, Ollama, etc.) |
| 4 | Tier-hint routing (which provider handles cheap/mid/deep?) |
| 5 | Embeddings config (enable/disable L4, choose provider - default: disabled) |
| 6 | Channel selection (CLI + Telegram in MVP, Discord deferred to v1.5+) |
| 7 | Persona seeding (operator chooses one of three modes - see B4) |
| 8 | Review + confirm |
| 9 | Initialize directories, write config, done |

### A2. Wizard resumability

Resumable. Wizard writes `~/.mypensieve/.init-progress.json` after each completed step. On re-run, asks "resume from step N?" Operator can also choose to restart from scratch.

### A3. First-run OAuth

Delegate to Pi's `pi auth login anthropic` command. MyPensieve calls it as a subprocess, parses the result, writes routing config. No custom callback server.

---

## B. Persona Seeding

### B4. Three modes offered at wizard Step 7

The operator chooses one:

| Mode | How it works | Time |
|------|-------------|------|
| **Guided questionnaire** | 8-10 structured questions covering role, goals, constraints, communication style, energy patterns, domain expertise, LLM operating principles, response style | ~5-10 min |
| **Free-form text** | Single prompt: "Tell me about yourself, how you work, and what you want from your AI agent." LLM extracts structured fields into `user.md` and `llm.md` | ~2-5 min |
| **Skip entirely** | No persona seeding at install. Persona builds organically from sessions via the extractor and synthesizer pipeline | 0 min |

All three modes produce the same output format (`workspace/personas/user.md` and `workspace/personas/llm.md`). The skip option starts with empty/minimal persona files.

---

## C. Session Lifecycle

### C5. CLI session flow

```
mypensieve start
  -> load channel binding (cli/<cwd-slug>)
  -> load project state
  -> interactive session (Pi's TUI with MyPensieve extensions loaded)
  -> exit
  -> SessionShutdownEvent
  -> extractor runs in background
```

No custom TUI wrapper. Pi's TUI is the interface.

### C6. MVP channels

| Channel | MVP status |
|---------|-----------|
| **CLI** | MVP |
| **Telegram** | MVP |
| **Discord** | Deferred to v1.5+ |

### C7. Telegram session lifecycle

```
operator sends message
  -> daemon listens (one daemon per operator)
  -> find/create session for peer_id (one-to-one mapping)
  -> route to in-process AgentSession
  -> stream response back to Telegram
  -> session times out after 30min inactivity
  -> SessionShutdownEvent
  -> extractor runs in background
```

### C8. Channel adapter model

MVP channel adapters use **in-process `AgentSession`** (matching pi-mom pattern). RPC mode exists but is not documented or tested in MVP. Deferred to v1.5+ if demand emerges.

---

## D. OAuth & Auth

### D8. OAuth refresh handling

**Parked until Pi re-audit on 2026-04-13.** Decision depends on whether Pi auto-refreshes OAuth tokens.

Contingency plan if Pi does NOT auto-refresh:
- **(b)** On-demand refresh when 401 detected (primary)
- **(a)** Nightly cron extension as belt-and-suspenders (secondary)
- Both implemented as MyPensieve extensions

---

## E. Memory & Extraction

### E9. Decision detection

Hybrid approach:
- **Manual `/decide` markers** - operator explicitly marks decisions. Confidence: **0.95**.
- **Auto-detection** - extractor prompt includes 5 positive and 5 negative examples of what counts as a decision. Catches ~20% of decisions the operator forgets to mark. Confidence: **0.65**.
- Operator can downvote low-confidence auto-detected decisions.

### E10. Persona contradiction detection

- Dedicated LLM call (deep tier) checks each new delta against the current persona file.
- Prompt: "Does this feedback delta contradict the current persona? Output: yes/no/unclear + confidence 0-1."
- Only surface to operator if contradiction confidence > 0.7.
- Cap: **3 pending persona changes per day** to avoid noise.

### E11. Nightly extractor idempotency

- Extractor tracks progress in `state/extractor-checkpoint.json` (last successfully processed session ID).
- If interrupted mid-run, resumes from checkpoint on next run.
- Safe to re-run (idempotent writes - append-only JSONL, SQLite transactions).
- Synthesizer uses SQLite transactions for atomicity during compaction.
- Recovery command: `mypensieve recover --reset-extractor` reprocesses all sessions from scratch (slow but safe).

---

## F. Council / Multi-Agent

### F12. Council checkpointer

- After each agent turn, write checkpoint to `research/<deliberation-id>/checkpoints.jsonl`.
- Checkpoint record: `[phase, agent, turn_number, content_hash]`.
- On interruption: read latest checkpoint, resume from next unfinished agent turn.
- Non-deterministic LLM output on resume is acceptable and documented.

### F13. Consensus/dissent flag

Council result schema includes explicit consensus tracking:

```json
{
  "consensus": true,
  "dissent": []
}
```

Or when agents disagree:

```json
{
  "consensus": false,
  "dissent": [
    "agent:critic - concerned about security implications of...",
    "agent:architect - prefers alternative approach because..."
  ]
}
```

Simple boolean + array of dissent strings. Operator sees this in the deliberation summary.

---

## G. Error Handling & Operations

### G14. Error notification deduplication

- Dedup key: `(error_type, error_src)` within a **1-hour window**.
- All occurrences logged to the error JSONL.
- Only the **first occurrence** surfaces to the operator, plus a count: "CVE monitor failed 50x in 1 hour."
- Dedup resets after the 1-hour window expires.

### G15. MVP recovery actions

| Action | MVP | Trigger |
|--------|-----|---------|
| Network retry | Yes | Connection errors, timeouts |
| Rate limit backoff | Yes | 429 responses |
| OAuth refresh | Yes (pending D8) | 401 responses |
| MCP restart | Yes | MCP process crash or unresponsive |
| Custom recovery registration | No (v1.5+) | Extensions register their own recovery actions |

### G16. Backup encryption & remote restore

| Feature | Status |
|---------|--------|
| Unencrypted tar.gz to local/rsync | MVP |
| Local restore (`mypensieve restore <file>`) | MVP |
| Encryption at rest | Deferred to v2 |
| Remote restore from URL/rsync target | Deferred to v2 |

---

## H. Meta-Skill Gateway

The gateway (N10) is MVP-critical. The agent never sees raw skills or MCPs - only the 8 typed verbs. Per-verb cost tracking is deferred to v2+.

### H17. Routing table format

**TypeScript schema + YAML user-extensible rules.**

- TypeScript provides type safety and validation for the routing schema.
- YAML files at `~/.mypensieve/meta-skills/<verb>.yaml` are user-editable.
- Custom skills self-declare which verb they back via `mypensieve_exposes_via` frontmatter. The YAML routing table picks them up.

### H18. Tool escape hatch enforcement

**Fail-fast at session start (binding validator).**

- Binding validator runs at session initialization.
- Pre-validates channel config. If a Telegram channel has `tool()` escape hatch enabled, session fails to start with a clear error.
- No runtime check needed - the invalid state is caught before any agent turn runs.

### H19. Per-verb cost tracking

**Deferred to v2+.** MVP tracks cost per tool call (already in OPERATIONS.md cost schema). Per-verb aggregation is a nice-to-have, not needed before the gateway works.

### Gateway MVP test requirements

The gateway phase is NOT complete until these security tests pass:

1. Agent cannot discover or invoke raw skill/MCP names (only 8 verbs visible).
2. `tool()` escape hatch is hard-blocked on Telegram channel.
3. `tool()` escape hatch is disabled by default on CLI, requires explicit opt-in.
4. Verb routing cannot be bypassed via prompt injection.
5. Each verb routes to the correct underlying skill/MCP.
6. `research` verb uses LLM router forced to cheap tier (never escalates to deep).
7. Custom skills with `mypensieve_exposes_via` frontmatter are picked up by the correct verb router.

---

## I. Skills & MCPs

### I20. Researcher skill LLM routing

Skill calls `pi-ai.complete()` directly with forced `tier_hint: cheap` for query planning, source dedup, synthesis, and citation. No sub-agent spawning.

### I21. Skill versioning & rollback

**Deferred to v1.5+.** MVP skills have no version management. Operators can git their skills directory if they want history. Future: `workspace/skills/<name>/history/<version>.md` with `mypensieve skill rollback <name> <version>`.

### I22. Skill-to-skill dependencies

**Deferred to v1.5+.** Skills can invoke other skills via `invoke_skill()` with a depth cap of 5, but no explicit dependency declarations in frontmatter. Implicit resolution only.

---

## J. CLI Surface

### J23. MVP command set

| Command | Purpose |
|---------|---------|
| `mypensieve init` | Run install wizard |
| `mypensieve start` | Start interactive CLI session |
| `mypensieve log` | Trigger daily-log skill manually |
| `mypensieve config edit` | Open config.json in editor |
| `mypensieve errors` | Show error log (filterable by severity/date) |
| `mypensieve recover` | Run automated recovery actions |
| `mypensieve doctor` | Healthcheck - verify all components are working |
| `mypensieve backup` | Manual backup |
| `mypensieve backup verify` | Verify backup integrity |
| `mypensieve restore <file>` | Restore from a backup file |
| `mypensieve deliberate` | Trigger council mode |
| `mypensieve agent add <name>` | Add a new agent persona |
| `mypensieve skill add <name>` | Add a skill to the active set |

13 commands total. Additional commands (e.g., `mypensieve status`, `mypensieve extract`) can be added during implementation if needed, but these 13 are the MVP floor.

---

## K. Deferred to Pi Re-Audit (2026-04-13)

These are not decisions - they are verification items that resolve after running `scripts/pi-reaudit.sh`:

| # | Item | What we're checking |
|---|------|-------------------|
| K24 | Extension dependency resolution | Does Pi's jiti loader handle bundled `package.json` in `~/.pi/agent/extensions/mypensieve/`? |
| K25 | Bun binary compatibility | Do extensions load correctly when Pi is installed as Bun single-binary? |
| K26 | RPC mode smoke test | Does `runRpcMode` actually work end-to-end for channel adapters? |
| K27 | API surface stability | Have `AgentSessionRuntime`, `createAgentSessionServices`, or extension types changed? |

If any of these come back Red (breaking change), the affected architecture doc gets amended and the implementation plan adjusts. See [PI-REAUDIT-CHECKLIST.md](PI-REAUDIT-CHECKLIST.md) for the full watch list and outcome buckets.

---

## Decision index

Quick reference - every decision in this doc with its ID:

| ID | Decision | Choice |
|----|----------|--------|
| A1 | Wizard flow | 9 steps (profile, project, provider, routing, embeddings, channels, persona, review, init) |
| A2 | Wizard resumability | Resumable via `.init-progress.json` |
| A3 | First-run OAuth | Delegate to Pi's `pi auth login anthropic` |
| B4 | Persona seeding | 3 modes: questionnaire, free-form, skip |
| C5 | CLI session flow | Pi TUI + MyPensieve extensions, extractor on exit |
| C6 | MVP channels | CLI + Telegram (Discord v1.5+) |
| C7 | Telegram lifecycle | Daemon per operator, 30min inactivity timeout |
| C8 | Channel adapter model | In-process AgentSession (RPC deferred v1.5+) |
| D8 | OAuth refresh | Parked until Pi re-audit 2026-04-13 |
| E9 | Decision detection | Manual markers (0.95) + auto-detection (0.65) |
| E10 | Contradiction detection | Deep-tier LLM call, cap 3/day, threshold 0.7 |
| E11 | Extractor idempotency | Checkpoint-based resume, idempotent writes |
| F12 | Council checkpointer | JSONL checkpoints per turn, resume on interrupt |
| F13 | Consensus flag | Boolean + dissent string array |
| G14 | Error dedup | By (type, src) per 1-hour window |
| G15 | MVP recovery actions | Network retry, rate limit, OAuth refresh, MCP restart |
| G16 | Backup encryption | Deferred to v2 |
| H17 | Routing table format | TypeScript schema + YAML user rules |
| H18 | Escape hatch enforcement | Fail-fast at session start |
| H19 | Per-verb cost tracking | Deferred to v2+ |
| I20 | Researcher LLM routing | Direct `pi-ai.complete(cheap)` |
| I21 | Skill versioning | Deferred to v1.5+ |
| I22 | Skill dependencies | Deferred to v1.5+ |
| J23 | CLI commands | 13-command MVP set |

---

## What's next

1. **2026-04-13** - Run Pi re-audit (`scripts/pi-reaudit.sh`). Resolve K24-K27. Resolve D8.
2. **Post re-audit** - Write the phased implementation plan with test gates per phase.
3. **Implementation begins** - Phase 1 starts only after re-audit clears Green or Yellow.
