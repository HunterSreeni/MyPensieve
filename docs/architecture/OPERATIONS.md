# MyPensieve - Operations
> Status: LOCKED | Created: 2026-04-08
> Companion to PI-FOUNDATION.md, MEMORY-ARCHITECTURE.md, TOOLSHED-BRIDGE-ARCHITECTURE.md, PROVIDERS.md, MULTI-AGENT-RUNTIME.md.
> This is the **runtime/operations layer** doc - what happens after you press start.

---

## WHY THIS DOC EXISTS

The other six docs cover **architecture** - how things are designed, what the pieces are, how they connect. They are read by someone building MyPensieve.

This doc covers **operations** - what happens after you press start. How the OS keeps itself alive, how it tells you when something broke, how it captures your daily state, how it protects your data. It is read by someone running MyPensieve on Day N+1, not building it on Day 0.

Three things this doc adds to the architecture:

| Section | What it adds | Why it matters |
|---|---|---|
| **Daily journal skill (N7)** | An EOD ritual that prompts the operator for wins/blockers/mood/energy and reads the day's data sources | Closes the loop: the OS captures everything, the operator confronts what got captured, the next day's work is informed by both |
| **Error handling (N8)** | Categories, capture, structured logging, surfacing policy, retry/circuit breakers, recovery commands | Without this, errors sit silently in log files. The operator only finds out when something is on fire. |
| **Backup and restore (N9)** | Daily tar.gz with 30-day retention, configurable destinations | After 3 months of accumulated memory, this is the most valuable thing on the machine |

Plus three supporting concerns: cron monitoring via the **reminders pattern**, the **`mypensieve doctor` healthcheck** command, and the **notification policy** that ties surfacing strategies together.

---

## DAILY JOURNAL SKILL (DECISION N7, LOCKED)

The single highest-leverage skill in MVP. It closes the loop between the OS's automatic capture and the operator's deliberate confrontation with their own state.

### Skill location

`~/.pi/agent/skills/daily-log/SKILL.md` - Pi-native skill format, dual frontmatter (Pi fields + MyPensieve extensions).

### Schedule

Cron-driven. Default: **20:00 local**. Configurable in `~/.mypensieve/config.json`:

```json
{
  "daily_log": {
    "enabled": true,
    "cron": "0 20 * * *",
    "channel": "cli",
    "auto_prompt_next_morning_if_missed": true
  }
}
```

### What the skill reads silently before prompting the operator

When invoked, the daily-log skill reads these data sources to build the day's digest, BEFORE asking the operator anything:

| Source | Filter | Why |
|---|---|---|
| `~/.mypensieve/projects/*/decisions.jsonl` | `timestamp >= today 00:00 local` | Show today's decisions across all projects |
| `~/.mypensieve/projects/*/threads.jsonl` | `created_at >= today` OR `still open` | Show today's open threads + carried-over from yesterday |
| `~/.mypensieve/logs/cost/<today>.json` | The full file | Today's spend by tier/provider |
| **`~/.mypensieve/logs/errors/<today>.jsonl`** | All entries | **Today's error digest - the bridge between N8 and N7** |
| `~/.pi/agent/sessions/<encoded-cwd>/*.jsonl` | `mtime >= today 00:00` | Today's session summaries (count, total tokens, channels used) |
| `~/.mypensieve/state/reminders/*` | All files | Cron job health check (any stale reminder = a job didn't run) |
| Yesterday's `daily-logs.jsonl` entry | The most recent one | What was promised yesterday, what is still pending |

### What the skill presents to the operator

```
========================================
MyPensieve - Daily Log for 2026-04-08
========================================

What happened today:
  4 decisions logged (3 in mypensieve, 1 in untagged)
  2 sessions, 12.4k tokens total
  $0.34 spent on anthropic, $0.00 on openrouter
  1 error (medium severity, in extension:memory at 14:22)
  3 cron jobs ran successfully, 1 reminder stale (backup did not run)

Open threads carried from yesterday:
  - Verify Ollama Cloud /v1 compat with curl test
  - Re-audit Pi after April 13 freeze ends

What you said yesterday:
  Mood: 4 / Energy: 3
  "Want to finish the toolshed doc tomorrow"  ← did you?

----------------------------------------
[Press enter to start the EOD log, or type 'skip' to defer to tomorrow]
```

### What the skill asks the operator

The EOD prompt has six fields, in order. Each is a separate input so the operator can think through one thing at a time and not be intimidated by a wall of questions.

| Field | Type | Required | Notes |
|---|---|---|---|
| **Wins** | Free text | No (defaults to "nothing notable") | What went well today. Specific, not generic. |
| **Blockers** | Free text | No | What is stuck. Surfaces tomorrow as carry-over. |
| **Mood** | Numeric 1-5 + optional free text | No (operator can leave both blank) | Numeric for trend graphs in v1.5+, free text for honesty. |
| **Energy** | Numeric 1-5 + optional free text | No | Same as mood. |
| **One thing to remember tomorrow** | Free text | No | Becomes a thread. Auto-loaded into tomorrow's L2 wake-up. |
| **Anything for weekly review?** | Free text | No | Flagged for the Sunday weekly synthesis. |

The operator can hit enter on any field to skip it. The skill never coerces honesty - if the operator does not feel like answering, the entry is partial. Partial entries are still valuable.

### Storage

The completed log entry is written as a single line to `~/.mypensieve/projects/<active>/daily-logs.jsonl`:

```json
{
  "id": "log-2026-04-08",
  "ts": "2026-04-08T20:14:22+05:30",
  "project": "mypensieve",
  "wins": "Locked memory architecture, wrote PI-FOUNDATION.md",
  "blockers": "Waiting on Pi OSS Weekend freeze to end",
  "mood": { "score": 4, "note": "Tired but the doc work was satisfying" },
  "energy": { "score": 3, "note": null },
  "remember_tomorrow": "Run the Ollama cloud curl test",
  "weekly_review_flag": "Should we promote backup retention to 60 days?",
  "digest_snapshot": {
    "decisions_count": 4,
    "sessions_count": 2,
    "tokens_total": 12400,
    "cost_usd": 0.34,
    "error_count": 1,
    "reminders_stale": ["backup"]
  }
}
```

The `digest_snapshot` field captures the state at the moment of the log so future queries can see "what did the day look like when you wrote this." Daily-log entries are queryable via `mypensieve logs` (see Recovery Commands below).

### Channel

Default channel for the daily-log prompt: **cli**. The cron job checks if a CLI session is currently running. If yes, it injects the prompt into that session as a system message. If no, it opens a new CLI session for the prompt.

**Future channels (v1.5+):** Telegram daily-log via the Telegram channel adapter. Operator gets a message at 20:00 with the prompt; replies are captured as the log entry.

### Missed entries

If the operator misses the EOD prompt (didn't respond, was offline, ignored it), the **next morning's session start** surfaces:

```
You did not log yesterday. Want to do it now? (y/n/skip)
```

If yes: opens the daily-log prompt with yesterday's data sources (the digest is built from yesterday's date, not today's). If no: yesterday's entry stays empty in `daily-logs.jsonl`. If skip: the OS does not ask again until next time.

The OS respects the operator's right to not log. It does not nag.

---

## ERROR HANDLING (DECISION N8, LOCKED)

Without this, errors sit silently in log files. The operator only finds out when something is on fire.

### Where errors come from (the sources)

| Source | Examples |
|---|---|
| **Pi extensions** (our code) | Memory extractor crashed, MCP client lost connection, channel binding file corrupted, persona injector could not load identity.md |
| **Pi itself** | Provider request failed permanently, agent loop hit unrecoverable state, session manager could not write JSONL |
| **Cron jobs** | Nightly extractor exited non-zero, backup job failed, OAuth refresher could not refresh, daily-log skill could not run |
| **External services** | Anthropic 500, Ollama daemon down, OpenRouter rate limit, network timeout, DNS failure |
| **Channel adapter daemons** | Telegram bot disconnected, Discord rate-limited, webhook delivery failed |
| **Data integrity** | SQLite corruption detected, JSONL line malformed, decision references missing project, schema migration failure |
| **Security** | Unauthorized skill invocation attempt blocked, denied MCP enable, blocked tool call, suspicious channel activity, prompt injection detected |

### Severity levels (N8 locked vocabulary)

Five levels. Every error has exactly one.

| Level | Meaning | Default surfacing |
|---|---|---|
| **critical** | Operator must intervene NOW. Examples: disk full, OAuth permanently failed, schema corruption, suspected security breach, all providers down | Telegram alert (if configured) + inline at next session start + daily digest |
| **high** | Operator should know today. Examples: cron job failed for the day, extension crashed mid-task, single provider down for >1 hour, backup failed | Inline at next session start + daily digest |
| **medium** | Worth noticing in daily review. Examples: rate limit retry succeeded after 3 attempts, single skill invocation failed, MCP reconnect, transient extractor error | Daily digest only |
| **low** | Background noise but logged. Examples: transient network error that retried once, deprecation warning, slow response (>5s) | Daily digest if anything else for that day, otherwise just logged |
| **info** | Not really an error. Examples: token refresh happened, cron job started, backup completed, extension loaded | Logged only, never surfaced |

### Error log format (the JSONL schema)

Stored at `~/.mypensieve/logs/errors/<YYYY-MM-DD>.jsonl`. One line per error. Indexed in `~/.mypensieve/index/memory.sqlite` for fast filtering.

```json
{
  "id": "err-2026-04-08-001",
  "schema_version": 1,
  "ts": "2026-04-08T03:14:22.847+05:30",
  "severity": "high",
  "src": "extension:memory",
  "type": "extraction_failed",
  "msg": "Decision extractor crashed reading session-2026-04-08-002.jsonl",
  "context": {
    "session_id": "session-2026-04-08-002",
    "phase": "decision_detection",
    "model_used": "anthropic/claude-sonnet-4-6",
    "input_tokens": 8421
  },
  "stack": "Error: Cannot read property 'turns' of undefined\n    at extractDecisions (.../memory.ts:247:14)\n    at ...",
  "correlation_id": "session-2026-04-08-002",
  "retry_count": 0,
  "max_retries": 0,
  "resolved": false,
  "resolved_at": null,
  "resolution_method": null,
  "resolution_note": null
}
```

Field semantics:

- `id` - unique error identifier (`err-<date>-<sequence>`)
- `severity` - one of the 5 levels
- `src` - where the error originated. Format: `<source-type>:<name>`. Examples: `extension:memory`, `extension:mcp-client`, `cron:nightly-extractor`, `provider:anthropic`, `daemon:telegram-channel`, `pi:agent-loop`
- `type` - a stable error classifier. Examples: `extraction_failed`, `oauth_expired`, `rate_limit_exhausted`, `mcp_server_crashed`, `schema_violation`, `disk_full`
- `correlation_id` - optional. Links related errors. Multiple errors during the same session share the session-id; multiple errors from one cron run share the run-id.
- `retry_count` / `max_retries` - tracks the retry policy state
- `resolved` / `resolved_at` / `resolution_method` / `resolution_note` - operator can resolve manually via `mypensieve errors resolve <id>` or auto-resolution can happen (e.g. successful retry sets `resolved: true, resolution_method: "retry_success"`)

### Retry policies

Different error types get different retry behavior. The error capture logic decides the policy based on `type`.

| Error type | Retry? | How |
|---|---|---|
| Network/transient (ECONNRESET, 503, 504) | Yes | Exponential backoff: 1s, 4s, 16s. Max 3 attempts. |
| Rate limit (429) | Yes | Honor `Retry-After` header if present, else exponential. Max 5 attempts. |
| OAuth expired (401 with known refresh token) | Yes | Auto-refresh via Pi's `AuthStorage` once, then retry. Fail to manual prompt if refresh fails. |
| Provider unhealthy (5xx for >5 min) | Yes (different) | Mark provider unhealthy, route to next tier_hint fallback if configured |
| Extension code error (TypeError, etc.) | No | Log and continue. Don't crash session. |
| Data integrity (corrupted JSONL, SQLite error) | No | Log critical and halt the affected operation. Operator must intervene. |
| Auth permanently failed | No | Critical alert. Operator must re-auth. |
| Disk full | No | Critical alert. |
| Skill invocation timeout (>max_runtime_sec) | No | Log medium, kill the skill, return error to caller. |

The retry happens at the error capture site, transparently. If retries succeed, the error is logged at `info` level with `resolution_method: "retry_success"`. If retries exhaust, the error is escalated to its target severity.

### Circuit breakers

Higher-level protection against cascading failures.

| Trigger | Action |
|---|---|
| Any single extension errors > 5 in 1 minute | Disable that extension for the rest of the session, log critical |
| Any single provider errors > 10 in 5 minutes | Mark provider unhealthy for 1 hour, route to next tier_hint fallback |
| Any single cron job fails 3 days in a row | Disable cron, alert operator, no auto-retry until manually re-enabled |
| Memory extractor fails on > 50% of yesterday's sessions | Halt extraction, alert operator critical, no auto-retry |
| More than 100 errors of any kind in 1 hour | Activate global rate-limit on all extension execution for 10 minutes, log critical |

Circuit breaker state lives at `~/.mypensieve/state/circuit-breakers.json`. Operator can manually reset via `mypensieve recover --reset-breakers`.

### Surfacing strategies (the four channels)

Errors are always written to `logs/errors/<date>.jsonl` regardless of severity. **Surfacing** is about which errors get pushed to operator attention, where, and when.

| Channel | What goes through it | Default policy |
|---|---|---|
| **Daily digest** | All errors from today's logs/errors/, all severities | Always on. Read by the daily-log skill at EOD. |
| **Inline at session start** | Only unresolved `high` or `critical` errors from the last 24h. The persona-injector extension prepends a one-liner to the system prompt. | Always on. |
| **Telegram push** | Only `critical`, real-time when the error happens. | Off by default. Opt-in via `config.json`. |
| **`mypensieve errors` CLI** | Anything, on demand with filters (`--since`, `--severity`, `--src`, `--unresolved`) | Always available. |

The operator never has to read raw log files. The system surfaces what needs attention through these four channels.

### The inline session-start hint

When the persona-injector extension wakes up at session start (`AgentStartEvent`), it queries the error index for unresolved `high` or `critical` errors from the last 24 hours. If any exist, it prepends a one-liner to the session's system prompt:

```
⚠ 2 unresolved errors since yesterday (1 critical, 1 high). Run `/errors` or `mypensieve errors` for details.
```

The operator sees this as the first thing the agent says. They can `/errors` from inside the session, or ignore it and the warning will appear again next session until the errors are resolved.

If there are zero unresolved high+ errors, no hint is prepended. Quiet days are quiet.

### Telegram critical alerts (opt-in)

Configurable in `~/.mypensieve/config.json`:

```json
{
  "errors": {
    "telegram_alerts": {
      "enabled": false,
      "channel_id": null,
      "minimum_severity": "critical",
      "rate_limit_per_hour": 5
    }
  }
}
```

When enabled, the error capture logic checks every error against the threshold and pushes a Telegram message via the Telegram channel adapter daemon. Rate-limited to prevent alert storms. Off by default because most operators do not want to be paged.

---

## BACKUP AND RESTORE (DECISION N9, LOCKED)

After 3 months of accumulated memory + decisions + sessions, this is the most valuable thing on the machine.

### What gets backed up

| Path | Included by default | Notes |
|---|---|---|
| `~/.mypensieve/projects/` | Yes | All distilled records, project state, daily-logs, decisions, threads |
| `~/.mypensieve/workspace/` | Yes | Identity, personas, persona history |
| `~/.mypensieve/index/` | Yes | SQLite indexes (rebuildable from JSONL but faster to restore) |
| `~/.mypensieve/research/` | Yes | Hash-addressed research artifacts + council deliberation transcripts |
| `~/.mypensieve/digests/` | Yes | Weekly + monthly synthesized summaries |
| `~/.mypensieve/logs/` | Yes | Audit, errors, decisions, cost - the operational history |
| `~/.mypensieve/state/` | Yes | Reminders, circuit breaker state |
| `~/.mypensieve/config.json` | Yes | The user-intent contract |
| `~/.mypensieve/channels/` | Yes | Channel bindings (no secrets in here, those are in .secrets/) |
| `~/.mypensieve/mcps/` | Yes | MCP definitions |
| `~/.pi/agent/sessions/` | **Yes** | Pi's raw session JSONL is the source of truth for raw transcripts. We cannot reconstruct it from anywhere else. |
| `~/.mypensieve/.secrets/` | **No (default)** | Mode 0700 secrets dir. Operator can opt in with `--include-secrets` if backing up to an encrypted destination. |
| `~/.pi/agent/auth.json` | **No (default)** | Same reason. Operator can opt in. |

### Format

`tar.gz`. Filename: `mypensieve-backup-YYYY-MM-DD-HHMMSS.tar.gz`.

Inside the tarball:

```
mypensieve-backup-2026-04-08-023000/
├── manifest.json                # backup metadata: schema_version, mypensieve_version, pi_version, included_paths, hashes, total_size
├── mypensieve/                  # everything from ~/.mypensieve/ (excluding .secrets/ unless --include-secrets)
│   ├── config.json
│   ├── projects/
│   ├── workspace/
│   ├── index/
│   └── ...
└── pi-sessions/                 # ~/.pi/agent/sessions/ if include_pi_sessions
```

### Schedule (default)

Daily at 02:30 local. After the nightly extractor + synthesizer runs at 02:00, before the morning routine. Configurable in `~/.mypensieve/config.json`:

```json
{
  "backup": {
    "enabled": true,
    "schedule": "30 2 * * *",
    "destinations": [
      {
        "type": "local",
        "path": "/mnt/external/mypensieve-backups/",
        "enabled": true
      }
    ],
    "retention": {
      "type": "days",
      "value": 30
    },
    "include_secrets": false,
    "include_pi_sessions": true,
    "compression": "gzip",
    "verify_after_write": true
  }
}
```

### Retention

**Default: 30 days of daily backups.** Configurable. Operator can extend to 60+ if they have the disk space - the install wizard suggests 60 if the configured destination has > 50GB free.

After 30 days, oldest backups are deleted to make room for new ones. Deletion is logged as an `info` event.

Weekly and monthly retention tiers (keeping a Sunday backup forever, etc.) are deferred to v2.

### Multiple destinations

Operator can configure more than one destination. Each is tried in order. Failures on one destination do not block the others. Failed destinations are logged as `high` severity errors.

Supported destination types in MVP:

| Type | Config | Notes |
|---|---|---|
| `local` | `path` | Filesystem path. Most common: an external drive mounted at `/mnt/external/`. |
| `rsync` | `host`, `path`, `ssh_key_secret` | Remote SSH target. Uses rsync for incremental sync. |
| `s3` | `bucket`, `region`, `access_key_secret`, `secret_key_secret`, `endpoint_url` (for R2/B2) | S3-compatible object storage. |

Future destinations (v2): Backblaze B2 SDK, Google Cloud Storage, Azure Blob, IPFS.

### Verify

`mypensieve backup verify <backup-file>` reads the tar.gz, validates structure against the manifest hashes, does NOT extract. Run automatically after every backup write if `verify_after_write: true`.

### Restore

`mypensieve restore <backup-file>`:

1. Validates tar.gz integrity via manifest hashes
2. Refuses to overwrite an existing `~/.mypensieve/` without `--force`
3. Extracts to `~/.mypensieve/` (and `~/.pi/agent/sessions/` if backup includes Pi sessions)
4. Re-runs `mypensieve reindex` to rebuild SQLite from JSONL
5. Validates the restore by running `mypensieve doctor`
6. Logs the restore as a `decision` record in the active project (so future operators see "memory was restored from backup on date X")

`mypensieve restore --dry-run <backup-file>` shows what would be extracted without actually extracting.

### Healthcheck integration

`mypensieve doctor` checks: when was the last successful backup? If it is older than the configured threshold (default: 2 days), the doctor reports `warn`. If older than 7 days, the doctor reports `fail`. The daily-log skill surfaces this in its digest:

```
⚠ Last successful backup: 4 days ago. Configured retention: 30 days. Run `mypensieve backup` now?
```

---

## CRON REMINDERS PATTERN (MONITORING IN MVP)

Every cron job touches a reminder file on success. Stale reminders = the job did not run = an error.

### Reminder files

Path: `~/.mypensieve/state/reminders/<job-name>`

Each file contains a single line with the timestamp of the last successful run:

```
2026-04-08T02:30:14.847+05:30
```

The cron job touches the file as the LAST step of its work. If the job fails partway through, the reminder is not updated, and on the next check the staleness becomes the signal.

### Reminder file naming

| Cron job | Reminder file |
|---|---|
| Nightly extractor (02:00) | `~/.mypensieve/state/reminders/extractor` |
| Backup (02:30) | `~/.mypensieve/state/reminders/backup` |
| OAuth refresher | `~/.mypensieve/state/reminders/oauth-refresh` |
| Weekly synthesizer (Sunday 03:00) | `~/.mypensieve/state/reminders/weekly-synthesis` |
| Reindex (on demand or weekly) | `~/.mypensieve/state/reminders/reindex` |

### Staleness check

The daily-log skill at 20:00 reads each reminder file and checks if it is older than expected:

| Job | Expected freshness | Check |
|---|---|---|
| extractor | < 24 hours | mtime since today 02:00 |
| backup | < 36 hours | mtime since today 02:30 (with 6h grace) |
| oauth-refresh | < 7 days | mtime within last week |
| weekly-synthesis | < 8 days | last Sunday + 1 day grace |
| reindex | < 14 days | (or whenever the operator last triggered) |

Stale reminders are logged as `high` severity errors with type `cron_reminder_stale` and surface in the daily digest:

```
⚠ Stale reminders detected:
  - backup: last run 4 days ago (expected daily)
  - extractor: last run 2 days ago (expected daily)
```

### Why this is enough for MVP

The reminders pattern is **option (a)** from earlier discussion - the simple version. It does not capture WHY a job failed, just that it did not run successfully. For most operators that is enough: when a stale reminder shows up, the operator runs `mypensieve errors --src cron:<job>` to find out why.

**Option (b) for v2:** structured run records in `~/.mypensieve/logs/cron/<date>.jsonl` with start time, end time, exit code, output summary, error messages. Richer history but more code. Defer.

---

## HEALTHCHECK COMMAND (`mypensieve doctor`)

The first thing the operator runs when something feels off.

### What it checks

```
$ mypensieve doctor
========================================
MyPensieve Healthcheck - 2026-04-08 14:22
========================================

[Pi installation]
  ✓ pi-coding-agent installed (v0.65.2)
  ✓ pi-ai installed
  ✓ Pi extensions loaded (mypensieve bundle: 9 extensions active)

[Authentication]
  ✓ anthropic OAuth token valid (expires 2026-05-12)
  ✓ openrouter API key present
  ⚠ ollama daemon: not running (last seen 4h ago)

[Filesystem]
  ✓ ~/.mypensieve/ exists (mode 0755)
  ✓ ~/.mypensieve/.secrets/ mode 0700
  ✓ ~/.mypensieve/config.json mode 0444 (read-only)
  ✓ ~/.pi/agent/ exists
  ✓ Disk space: 142 GB free on /home (warn threshold: 5 GB)

[Configuration]
  ✓ config.json parses cleanly
  ✓ All routing entries reference valid providers
  ✓ At least one provider configured (anthropic, openrouter)

[Memory layer]
  ✓ SQLite indexes intact (memory.sqlite, facts.sqlite)
  ✓ All projects have valid state.md
  ✓ No orphaned decision references

[Cron health (reminders)]
  ✓ extractor: last run 8 hours ago
  ⚠ backup: last run 4 days ago (expected daily)
  ✓ oauth-refresh: last run 2 days ago
  ✓ weekly-synthesis: last run 3 days ago

[Errors]
  ✓ 0 critical unresolved
  ⚠ 2 high unresolved (run `mypensieve errors --severity high --unresolved`)
  ✓ 5 medium errors today, all auto-resolved

[Backup]
  ⚠ Last successful backup: 4 days ago (configured retention: 30 days)
  → Suggested action: run `mypensieve backup` now

[Embedding]
  ✗ Ollama daemon not reachable - L4 semantic search disabled
  → Suggested action: start ollama (`ollama serve &`) or run `mypensieve config edit` to disable embedding

----------------------------------------
Overall: WARN (3 warnings, 1 failure)
========================================
```

### Output format

Each check returns one of: `pass` (✓), `warn` (⚠), `fail` (✗). The overall verdict is the worst of any individual check.

### Exit codes

- `0` - all pass
- `1` - one or more warns, no fails
- `2` - one or more fails

Useful for cron-based monitoring (e.g. a daily cron that runs `mypensieve doctor` and pages if exit code > 1).

### What doctor does NOT do

- It does not auto-fix anything. Doctor diagnoses, the operator (or `mypensieve recover`) fixes.
- It does not run expensive operations. No actual provider calls (just reads cached health). No backup verification (just reads the latest backup's manifest). Should complete in under 5 seconds.

---

## RECOVERY COMMANDS

The operator-facing CLI for dealing with errors and operational concerns.

| Command | Purpose |
|---|---|
| `mypensieve doctor` | Healthcheck (described above) |
| `mypensieve errors` | List recent errors with filters |
| `mypensieve errors show <id>` | Show full detail of one error |
| `mypensieve errors resolve <id> [--note "..."]` | Mark resolved manually |
| `mypensieve recover <id>` | Run an automated recovery if registered for that error type |
| `mypensieve recover --reset-breakers` | Reset all circuit breakers (use after fixing the underlying issue) |
| `mypensieve backup` | Run a backup now (manual override of the cron) |
| `mypensieve backup verify <file>` | Verify a backup file's integrity |
| `mypensieve restore <file> [--dry-run] [--force]` | Restore from backup |
| `mypensieve log` | Run the daily-log skill manually (instead of waiting for cron) |
| `mypensieve logs` | Query daily-log entries (`--week`, `--mood-trend`, `--project`) |
| `mypensieve reindex` | Rebuild SQLite indexes from JSONL source-of-truth |

### `mypensieve errors` filters

```
mypensieve errors                                # all errors from today
mypensieve errors --since 2026-04-01            # since a date
mypensieve errors --since 7d                    # last 7 days
mypensieve errors --severity high                # high or worse
mypensieve errors --severity critical            # critical only
mypensieve errors --src extension:memory         # by source
mypensieve errors --type extraction_failed       # by error type
mypensieve errors --unresolved                   # unresolved only
mypensieve errors --resolved                     # resolved only
mypensieve errors --correlation-id session-...   # all errors from one session
```

### Example output

```
$ mypensieve errors --severity high --unresolved

ID                    SEVERITY  SRC                  TYPE                  TIMESTAMP            MSG
err-2026-04-04-002    high      cron:backup          backup_failed         2026-04-04 02:32:11  Could not write to /mnt/external/...
err-2026-04-08-001    high      extension:memory     extraction_failed     2026-04-08 03:14:22  Decision extractor crashed reading...

2 unresolved high errors. Run `mypensieve errors show <id>` for details.
```

### Automated recovery actions

Some error types have registered recovery actions that `mypensieve recover <id>` can run:

| Error type | Recovery action |
|---|---|
| `oauth_expired` | Trigger OAuth refresh flow |
| `mcp_server_crashed` | Restart the MCP server |
| `cron_reminder_stale` | Run the cron job manually now |
| `sqlite_corruption` | Rebuild from JSONL via reindex |
| `backup_failed` | Retry backup with verbose output |
| `provider_unhealthy` | Reset provider health flag, retry next request |

For error types without a registered recovery action, `mypensieve recover <id>` outputs:

```
No automated recovery available for error type 'extraction_failed'. 
Suggested manual steps:
  1. Check the session JSONL at <path>
  2. Verify the decision_extractor.ts code did not change recently
  3. Run `mypensieve extract --session <id>` to retry manually
```

---

## NOTIFICATION POLICY (THE FULL TABLE)

How errors and operational events are surfaced to the operator. This is the policy that ties N7 (daily journal) and N8 (errors) together.

| Event | Daily digest | Inline at session start | Telegram (opt-in) | CLI on demand |
|---|---|---|---|---|
| **Critical error (fresh, unresolved)** | ✓ | ✓ | ✓ (if enabled) | ✓ |
| **High error (fresh, unresolved)** | ✓ | ✓ | ✗ | ✓ |
| **Medium error** | ✓ | ✗ | ✗ | ✓ |
| **Low error** | ✓ (only if other errors that day) | ✗ | ✗ | ✓ |
| **Info event** | ✗ | ✗ | ✗ | ✓ |
| **Stale cron reminder** | ✓ | ✓ (if > 1 day stale) | ✓ if critical | ✓ |
| **Backup overdue (> 2 days)** | ✓ | ✓ | ✗ | ✓ |
| **Backup overdue (> 7 days)** | ✓ | ✓ | ✓ | ✓ |
| **OAuth token expiring within 7 days** | ✓ | ✓ | ✗ | ✓ |
| **OAuth token expired** | ✓ | ✓ | ✓ | ✓ |
| **Disk space < 5GB free** | ✓ | ✓ | ✓ | ✓ |
| **All providers down** | ✓ | ✓ | ✓ | ✓ |
| **Single provider unhealthy (auto-fallback worked)** | ✓ | ✗ | ✗ | ✓ |
| **Council deliberation completed** | ✓ | ✗ | ✗ | ✓ |
| **Cron job ran successfully** | ✗ | ✗ | ✗ | ✓ |

The principle: **the operator should never be surprised**, but should also never be paged for non-critical things. The daily digest is the main interface; inline session-start hints catch the stuff that needs attention TODAY; Telegram is the page for genuine emergencies; CLI is always available for ad-hoc queries.

---

## RELATIONSHIP TO OTHER LOCKED DECISIONS

| Other doc / decision | How it interacts with operations |
|---|---|
| **N1 (embeddings)** | Doctor checks if Ollama is running. Stale embeddings job logged as cron reminder. |
| **N2 (skills/toolshed)** | Daily-log is itself a skill. Errors from skill invocations flow through the audit log into errors. |
| **N3 (config)** | Backup includes config.json. Restore validates config schema. |
| **N4 (providers)** | Errors from provider calls (rate limit, 5xx, OAuth) are first-class. Doctor checks provider health. |
| **N5 (Pi foundation)** | Pi's session JSONL is in the backup. Pi extension errors flow through our error log. |
| **N6 (council)** | Council deliberation completion is a notification event. Council errors (e.g. one phase failed) are tracked. |
| **Memory architecture** | The error log is queryable from the memory subsystem. Errors can be cited by decisions ("we made this choice because of error err-2026-04-08-001"). |

---

## DIRECTORY STRUCTURE (operations subsystem)

```
~/.mypensieve/
├── config.json                      # backup, daily_log, errors sections live here
├── state/
│   ├── reminders/                   # cron reminder files (touch on success)
│   │   ├── extractor
│   │   ├── backup
│   │   ├── oauth-refresh
│   │   ├── weekly-synthesis
│   │   └── reindex
│   └── circuit-breakers.json        # circuit breaker state
├── projects/<active>/
│   └── daily-logs.jsonl             # operator's EOD entries
├── logs/
│   ├── errors/
│   │   ├── 2026-04-08.jsonl         # daily error logs
│   │   └── ...
│   ├── cost/
│   │   └── 2026-04-08.json          # daily cost rollup (per-provider, per-tier)
│   ├── audit/
│   │   └── 2026-04-08.jsonl         # bridge audit log (every skill/MCP/agent call)
│   └── decisions/
│       └── 2026-04-08.jsonl         # symbolic decision log (alongside per-project decisions.jsonl)
└── (backup destinations are external paths configured in config.json)
```

---

## SUMMARY OF LOCKED CHOICES

| # | Decision | Choice |
|---|---|---|
| **N7** | **Daily journal skill** | Cron-driven at 20:00 local default, configurable. Reads decisions/sessions/cost/errors/reminders before prompting. Asks 6 fields (wins, blockers, mood [1-5 + free text], energy [1-5 + free text], remember-tomorrow, weekly-review-flag). Stores entries in `projects/<active>/daily-logs.jsonl` with a digest snapshot. Missed entries surface next morning with non-nagging prompt. |
| **N8** | **Error handling** | 5 severity levels (`critical | high | medium | low | info`). Structured JSONL log at `logs/errors/<date>.jsonl` indexed in SQLite. Retry policies per error type. Circuit breakers at extension, provider, cron, and global level. Surfacing through 4 channels: daily digest (always), inline session-start (high+ unresolved last 24h), Telegram (critical only, opt-in), CLI on demand. Recovery commands: `mypensieve errors`, `mypensieve recover`, `mypensieve doctor`. |
| **N9** | **Backup and restore** | Daily tar.gz at 02:30 local (after 02:00 nightly extractor). 30-day retention default, configurable. Multiple destinations supported (local, rsync, S3-compatible). Backup includes `~/.mypensieve/` + `~/.pi/agent/sessions/`. Excludes secrets by default (opt-in via `--include-secrets`). `mypensieve backup`, `mypensieve restore`, `mypensieve backup verify` commands. Healthcheck warns at 2 days overdue, fails at 7 days. Weekly/monthly retention tiers deferred to v2. |
| Cron monitoring | **Reminders pattern (option a) for MVP** | Each cron job touches `~/.mypensieve/state/reminders/<job-name>` with a timestamp on success. Daily-log skill checks for stale reminders. Structured run records (option b) deferred to v2. |
| Healthcheck | **`mypensieve doctor`** | Read-only diagnostic. Returns pass/warn/fail per check. Exit codes 0/1/2 for cron-friendly use. Does not auto-fix. |
| Notification policy | **4 channels** | Daily digest (always), inline session-start (high+ only), Telegram (critical only, opt-in), CLI (always). The operator should never be surprised but never paged unnecessarily. |

---

## OPEN QUESTIONS (NOT BLOCKING MVP)

1. **Mood/energy trend visualization** - V1.5+ feature: a `mypensieve logs --mood-trend` ASCII graph. Probably needs a small chart library or hand-rolled ASCII rendering.
2. **Daily-log via Telegram** - V1.5+ when the Telegram channel adapter is mature. The operator gets a 20:00 message with the prompt, replies are captured.
3. **Recovery action registry** - the list of automated recoveries above is the MVP set. v1.5+ should make registration extensible (extensions can register their own recovery actions).
4. **Backup encryption** - at-rest encryption for backups going to untrusted destinations. v2.
5. **Remote restore** - `mypensieve restore` from a URL or remote rsync target. v1.5+.
6. **Notification deduplication** - if the same error fires 50 times in an hour, the operator should not get 50 surfacing events. The capture logic should deduplicate by (type, src) within a window. MVP-feasible, design TBD.
7. **Daily-log gamification temptation** - resist this. Mood tracking with streaks and badges is a trap. Defer indefinitely.

---

*Implementation note: when MyPensieve gets built, this doc is the contract. Any deviation must be a new locked decision documented here, not silent drift.*
