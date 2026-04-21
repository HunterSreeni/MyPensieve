# Changelog

All notable changes to MyPensieve are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.3] - 2026-04-21

Bug fix.

### Fixed
- **`mypensieve init` overwrote existing installs with no confirmation** (`src/cli/commands/index.ts`). Re-running init on a machine that already had `~/.mypensieve/config.json` silently replaced config, persona files, and could clobber secrets. Now init detects the existing config, prints what will be replaced, and blocks on a confirm prompt. Pass `--force` to skip the prompt (for automation).

---

## [0.3.2] - 2026-04-21

Bug fix.

### Fixed
- **Wizard could leave Telegram enabled with an empty allowlist** (`src/wizard/steps.ts`). If the user enabled the Telegram channel but pressed Enter on the peer-ID prompt, the config was written with `channels.telegram.enabled: true` and `allowed_peers: []`. The daemon would start a bot that silently rejected every inbound message. Wizard now auto-disables the channel in that case and prints a one-liner recovery path (edit config, add peer, set enabled back to true).

---

## [0.3.1] - 2026-04-21

Bug fix.

### Fixed
- **Wizard API key validation logic was inverted** (`src/wizard/steps.ts`). The probe returned `true` for any non-401 HTTP response, so 403 (suspended key), 429 (quota), and other 4xx rejections were silently accepted as valid. Now only 2xx counts as valid; 4xx fails the check; 5xx and network errors are treated as transient and don't block the wizard.

---

## [0.3.0] - 2026-04-20

v0.3.0 - autonomous operations, operator-in-the-loop safety, persona loadouts, multi-provider memory pipeline, full gateway wiring in Telegram.

### Highlights
- **Echoes wired**: daily-log reminders, nightly memory extraction, and automated backups now fire on their configured crons via an in-process scheduler. No system cron required.
- **Dispatch confirm enforcement**: destructive `dispatch` verb is gated by an operator confirmation prompt. CLI uses interactive `@clack/prompts`, Telegram uses inline Approve/Deny buttons (60s auto-deny timeout).
- **Persona loadouts**: maintain multiple switchable agent identities under `~/.mypensieve/loadouts/<name>/`. New CLI: `mypensieve persona list | switch | create | show | delete`. Auto-migrates existing single-persona installs into a `default` loadout.
- **Multi-provider extractor**: all 4 providers (Ollama, Anthropic, OpenAI, OpenRouter) wired as memory-extractor backends. API key resolved once per run (fails fast if missing).
- **Synthesizer**: decision de-duplication + persona-delta aggregation. `mypensieve synthesize [--apply]` CLI (report-only default) + post-extract synth in nightly echo.
- **Per-channel extractor checkpoints**: CLI and Telegram sessions advance independently via `.extractor-anchors.json`. Channel attribution via session-meta markers written by each channel.
- **Telegram gateway wiring**: the 8-verb gateway now loads as a session-scoped extension in every Telegram peer session, with per-peer ConfirmProvider + registry.
- **Verb-level write-path guardrail**: `produce.output_path` validated against the filesystem allow-list before skill execution.

### Security
- `confirm:false` cannot be set by the LLM to bypass the confirm provider; the dispatcher always calls the provider for destructive verbs.
- Telegram inline-button callbacks are bound to the requesting peer; other allowed peers (e.g. in a group) cannot tap through another peer's confirmation.
- Operator-denied verb calls logged as `audit.fail` with `operator_denied` reason so audit readers can tell "executed successfully" from "operator refused to approve".
- Session-meta filenames include a sha256 suffix to avoid sanitization collisions.
- Provider-complete shims never include API keys or request bodies in captured errors.

### Config additions
- `extractor.synthesize_after: boolean` (default `true`) - run the synthesizer in report-only mode after each nightly extraction.
- `security.daemon_confirm_policy: "deny" | "allow" | "require_provider"` (default `deny`) - policy for destructive verb calls in unattended/daemon contexts.

### New CLI commands
- `mypensieve persona <subcommand>` - manage persona loadouts
- `mypensieve synthesize [--apply] [--project <binding>]` - run the memory synthesizer

### Stats
- 579 tests across 51 test files (was 525 at v0.2.0)
- 54 new tests added during v0.3.0 development
- 3-agent code review pass + focused fix-review pass: 17 distinct issues found and fixed before release

---

## [0.2.0] - 2026-04-16

v0.2.0 stable release - multi-provider, multi-model council, persona split, personality-driven greetings.

### Highlights
- **Multi-provider support**: Ollama, Anthropic, OpenRouter, OpenAI - all 4 providers wired end-to-end (wizard, channels, council)
- **Multi-model council**: Different council agents can use different providers/models
- **Council persona split**: Protocol locked in TypeScript, personality editable in .md files
- **Personality-driven greetings**: Randomized greetings from personality-keyed pools
- **Wizard TUI overhaul**: @clack/prompts replaces raw readline - select, confirm, spinner, note boxes
- **Pi SDK 0.67.3**: SIGTERM session shutdown, stack overflow fix, UUIDv7 session IDs
- **Ops automation**: Version update check on CLI startup, auto-doctor timer (every 3 days), version script

### Security (hardening from pre-release audit)
- Telegram sanitizer: added Anthropic (sk-ant-) and OpenRouter (sk-or-) API key patterns
- Empty .md persona files fall back to defaults (no silent empty personality)
- Greetings.json validates array types, rejects non-array values
- Size caps: 100KB for persona .md files, 1MB for greetings.json

### Stats
- 525 tests across 42 test files (was 464 at v0.1.15)
- 61 new tests added during v0.2.0 development

### Deferred to v0.3.0
- MCP integration (Pi has no built-in MCP - needs custom tool registration via pi.registerTool)
- Echo wiring (daily-log, backup)
- Dispatch confirm enforcement

---

## [0.2.0-alpha.4] - 2026-04-16

Phase 4/5: Personality-driven greetings.

### Added
- **Greetings system** (`src/core/greetings.ts`): `pickGreeting(personality, agentName)` selects a random greeting from `~/.mypensieve/persona/greetings.json` based on the agent's personality style. Supports `{name}` template variable.
- **Greetings template**: `writeGreetingsTemplate()` scaffolds `greetings.json` with 4 personality pools (formal, casual, snarky, witty) during `mypensieve init`.
- **Greeting injection**: Extension `before_agent_start` injects a `[Session Greeting]` block on the first turn of each session. Controlled by `config.agent_persona.personality` field. Subsequent turns skip the greeting.
- **Personality field** added to `AgentPersonaSchema` (optional string, e.g. "formal", "casual", "snarky", "witty").
- **Wizard**: Agent identity step now prompts for greeting style via select menu.

### Tests
- 11 new tests for greetings (load, pick, {name} replacement, empty pool, missing file, template creation, no-overwrite). Total suite: 525 tests (was 514).

---

## [0.2.0-alpha.3] - 2026-04-16

Phase 3/5: Council persona split - protocol in TS, personality in .md files.

### Added
- **Personality loader** (`src/council/personality-loader.ts`): `loadCouncilPersonality(agentName)` reads from `~/.mypensieve/persona/{agent-name}.md`, falls back to hardcoded defaults, caches per process.
- **Council persona templates**: `writeCouncilPersonaTemplates()` scaffolds 4 .md files during `mypensieve init` (orchestrator, researcher, critic, devil-advocate). Only writes if file doesn't exist (preserves operator edits).
- `DEFAULT_PERSONALITIES` export in `personas.ts` - the editable personality text for each agent.

### Changed
- **Persona split**: Each council agent now has two layers:
  - Protocol (hardcoded in TS): phase participation, verb access, structured channels. Cannot be broken by editing.
  - Personality (in .md files): tone, strictness, focus areas. Operator edits freely.
- **CouncilManager.deliberate()** now assembles full prompt as `protocol + [Personality] + loaded personality text` before calling the agent responder.
- `personas.ts` `systemPrompt` fields now contain ONLY protocol instructions (prefixed with `[Protocol: AgentName]`).

### Tests
- 9 new tests for personality loader (file loading, template detection, caching, cache clearing, all 4 agents) and council persona templates (creation, skip existing). Total suite: 514 tests (was 505).

---

## [0.2.0-alpha.2] - 2026-04-16

Phase 2/5: Multi-model council registration.

### Added
- **Multi-provider registration** (`src/providers/multi-register.ts`): `buildRegistrationPlan()` collects all unique provider/model pairs from `default_model` + `agent_models`, groups by provider, resolves API keys. `executeRegistrationPlan()` registers all providers in one pass with batched models.
- **Wizard routing step upgraded**: clack UI with provider format examples, note boxes for model assignments.

### Changed
- CLI and Telegram channels now register ALL providers from config (default + per-agent) in a single pass, not just the default provider. Different council agents can now use different providers (e.g. orchestrator on Ollama, researcher on Anthropic).
- Registration plan warnings (missing API keys, unsupported providers) logged to stderr and captured in error log.

### Tests
- 7 new tests for multi-register (plan building, deduplication, batching, missing keys, unsupported providers). Total suite: 505 tests (was 498).

---

## [0.2.0-alpha.1] - 2026-04-16

Phase 1/5: Wizard multi-provider menu + TUI upgrade (@clack/prompts).

### Added
- **@clack/prompts v1.2.0** replaces raw readline in the wizard. Beautiful select/confirm/text prompts with intro/outro banners, spinner for async operations, and note boxes for summaries.
- **Multi-provider wizard**: `mypensieve init` now lets you choose between Ollama, Anthropic, OpenRouter, and OpenAI. Non-Ollama providers prompt for API key with validation probe, save to `.secrets/{provider}.json`, and prompt for model ID with provider-specific hints.
- Wizard UI improvements: intro banner, note boxes for config summary, spinner for Ollama probe and API key validation, outro with next steps.

### Changed
- `src/wizard/prompt.ts` fully rewritten: `ask`, `confirm`, `choose` now use @clack/prompts. New exports: `multiselect`, `spin`, `intro`, `outro`, `note`.
- `src/wizard/steps.ts` providers step rewritten for multi-provider flow.

---

## [0.1.18] - 2026-04-16

Multi-provider channels - Anthropic, OpenRouter, and OpenAI now work in CLI and Telegram.

### Changed
- **CLI channel** (`src/channels/cli/start.ts`): Removed Ollama-only guard. Provider registration now dispatches through the factory (`registerProviderByName`). API keys read from `.secrets/{provider}.json` for non-Ollama providers.
- **Telegram channel** (`src/channels/telegram/start.ts`): Same changes. Per-peer sessions now support any registered provider.
- Log output shows `Model: provider/model` for all providers. Ollama additionally shows `via host:port`.
- Error messages updated: unsupported provider now lists all 4 supported options.

### Note
To use a non-Ollama provider:
1. Run `mypensieve init --restart` and pick the provider (wizard multi-provider menu comes in a later patch)
2. Or manually: set `default_model` to e.g. `anthropic/claude-sonnet-4-6` in config.json and create `~/.mypensieve/.secrets/anthropic.json` with `{"api_key":"sk-ant-..."}`.

---

## [0.1.17] - 2026-04-16

Ops automation - version update checks and auto-doctor timer.

### Added
- **Version update check** on CLI startup: non-blocking npm registry query with 3s timeout and 24h cache. Prints update notice to stderr when a newer version is available, and nudges `mypensieve doctor` after upgrade.
- **Doctor timer** (`mypensieve doctor install|uninstall|status`): systemd timer that runs `mypensieve doctor` every 3 days at noon. `Persistent=true` catches up after laptop was off.
- **Doctor check: Version** - queries npm registry during healthcheck, warns if behind.
- **Doctor check: Extractor Timer** - warns if the extractor timer is not installed.

### Tests
- 4 new tests for update-check (cache, newer/same/older version, offline). Total suite: 498 tests (was 494).

---

## [0.1.16] - 2026-04-16

Pi SDK upgrade + multi-provider infrastructure (v0.2.0 groundwork).

### Changed
- Upgraded `@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent` from 0.66.1 to 0.67.3
- Key improvements from Pi 0.67.x:
  - `session_shutdown` now fires on SIGHUP and SIGTERM (critical for systemd daemon graceful shutdown)
  - Long-session stack overflow fix (`Container.render()` with large transcripts)
  - Session IDs now use UUIDv7 for better time locality
  - npm package update check works with non-default registries
  - Auto-retry shows live countdown during backoff

### Added
- **Provider factory** (`src/providers/factory.ts`): `registerProviderByName()` and `registerProviderWithModels()` dispatch registration to the correct provider module. Supports: `ollama`, `anthropic`, `openrouter`, `openai`.
- **Provider modules** for Anthropic (`src/providers/anthropic.ts`), OpenRouter (`src/providers/openrouter.ts`), and OpenAI (`src/providers/openai.ts`). Each includes a model catalog with correct costs, context windows, and compat flags.
- **Provider secrets reader** (`src/providers/secrets.ts`): `readProviderApiKey()` reads API keys from `~/.mypensieve/.secrets/{provider}.json` with permission checks (0600 file, 0700 directory).
- **Provider type contract** (`src/providers/types.ts`): shared `ProviderRegistrationOptions` and `RegisterProviderFn` interfaces.

### Tests
- 30 new tests (8 factory, 8 secrets, 5 Anthropic, 4 OpenRouter, 5 OpenAI). Total suite: 494 tests (was 464).

### Automation
- `scripts/on-version.sh` auto-patches KNOWN-LIMITATIONS.md header and validates CHANGELOG.md on every `npm version` bump
- E2E journal test uses relative dates (no more stale time-dependent failures)

### Note
Provider modules are registered but not yet wired into channel start files (CLI/Telegram still use Ollama-only path). Channel wiring comes in v0.1.17.

---

## [0.1.15] - 2026-04-14

Memory extraction pipeline shipped + security hardening pass.

### Added
- Memory extraction pipeline (Phase 2 kick-off):
  - `src/memory/extractor.ts` - `runExtraction()` reads Pi session JSONLs, distills them into decisions / threads / persona deltas via Ollama, writes to the existing layers.
  - `src/memory/session-reader.ts` - enumerates, filters by timestamp, and normalizes Pi sessions.
  - `src/providers/ollama-complete.ts` - one-shot non-streaming `/api/chat` wrapper with `format: "json"`.
  - Anchor checkpoint at `<projectsDir>/.extractor-anchor.json` for idempotent incremental runs across all bindings.
- CLI: `mypensieve extract [--all] [--since <iso>] [--dry-run] [--verbose]`.
- CLI: `mypensieve extractor install | uninstall | status` - systemd user timer driven by `config.extractor.cron` (default `0 2 * * *`).
- Agent-facing `memory-extract` skill, reachable via the `dispatch` verb with `action: "memory.extract"`. Default skill registry grows from 9 to 10 skills.

### Security (hardening from internal audit of the new memory surface)
- `dispatch`-mode invocations of the memory-extract skill now strip underscore-prefixed params (`_sessionsDir`, `_projectsDir`, `_complete`). These test hooks are honored only on direct handler calls, closing an arbitrary-path read/write path that a remote peer could otherwise reach via Telegram `dispatch`.
- Session transcripts are passed through `redactSecrets` before being embedded in the extraction prompt, preventing bot tokens, bearer tokens, and API keys that appeared in prior tool outputs from leaking into the LLM prompt.
- `runExtraction` acquires a pidfile lock at `<projectsDir>/.extractor.lock`. Concurrent runs (manual + systemd timer, or two remote triggers) no longer race; the second caller returns immediately with an `already in progress` failure. Stale locks (dead pid) are reclaimed.
- Session JSONL files larger than 50 MB (`MAX_SESSION_JSONL_BYTES`) are skipped before being read into memory, preventing OOM from a runaway or malicious transcript.
- Ollama completions are truncated at 256 KB (`MAX_COMPLETION_BYTES`) before `JSON.parse`, capping downstream parse work from a misbehaving model.

### Tests
- 32 new tests covering the extractor, skill wiring, and security regressions (17 unit + 2 integration + 1 e2e + 5 skill + 7 security). Total suite: 464 tests (was 432).

---

## [0.1.14] - 2026-04-13

Systemd daemon - MyPensieve runs as a persistent background service.

### Added

- **`mypensieve daemon install`**: Creates a systemd user service (`~/.config/systemd/user/mypensieve.service`) that runs `mypensieve start` as a background process. Auto-restarts on failure (5s delay). Starts on boot when loginctl linger is enabled. No sudo required.
- **`mypensieve daemon uninstall`**: Stops and removes the systemd service cleanly.
- **`mypensieve daemon status`**: Shows service state (active/inactive), enabled status, linger status, and last 5 log lines from journalctl.
- **Security hardening in unit file**: `NoNewPrivileges=true`, `ProtectSystem=strict`, `PrivateTmp=true`, `ReadWritePaths` limited to `~/.mypensieve`.

### Fixed

- **Config privacy rule (Rule 8)**: Strengthened to explicitly prevent reading config.json with tools. Agent already has config values in its system prompt context.

---

## [0.1.13] - 2026-04-13

CLI improvements - version flag, status command, Ollama health check.

### Fixed

- **`--version` / `-v` flag**: Was hardcoded to `v0.1.0`. Now reads from package.json at runtime via `src/version.ts`.

### Added

- **`mypensieve status` command**: Shows version, operator, model, Ollama host, channels, persona, embeddings, and backup status without needing a running bot.
- **Ollama connectivity check in `doctor`**: Verifies the Ollama daemon is reachable and the configured model exists. Reports clear errors when Ollama is down or model is missing.

---

## [0.1.12] - 2026-04-13

Fix command handler registration order.

### Fixed

- **Commands not firing**: `/help`, `/status`, `/start`, `/reset` were being swallowed by `bot.on("message:text")` because grammy middleware runs in registration order. Moved all `bot.command()` handlers before the text message handler so commands are caught first.

---

## [0.1.11] - 2026-04-13

Telegram bot commands, version awareness, config privacy, and docs refresh.

### Added

- **`/status` command**: Shows version, model, uptime, active sessions count.
- **`/help` command**: Lists all available bot commands.
- **Version in system prompt**: Agent now knows what version it's running and can answer "what version are you?"
- **`src/version.ts`**: Runtime version reader from package.json.

### Security

- **Config privacy rule (Rule 8)**: Agent must not dump raw config.json values (allowed_peers, operator name, model strings). Can confirm enabled/disabled but not echo specific values.
- **Output sanitizer**: `allowed_peers` arrays in JSON output are now redacted before Telegram replies.

### Changed

- Updated `docs/KNOWN-LIMITATIONS.md` to reflect all fixes from v0.1.6-v0.1.10 (security guardrails section rewritten, removed stale entries).

---

## [0.1.10] - 2026-04-13

Fix "(no response)" bug + security hardening from black-box testing.

### Fixed

- **"(no response)" on Telegram**: `extractResponseText()` now falls back to tool result content when the agent responds with tool calls but no text commentary. Tool results are truncated to 1000 chars and prefixed with the tool name. Previously, any tool-only response showed "(no response)".

### Security

- **System prompt leakage hardening**: BB testing revealed "translate to French" leaked the agent persona. Security rules now explicitly cover ALL leakage vectors: translate, encode, paraphrase, summarize, reword.
- **Secrets access hardening**: Agent was reading `.secrets/telegram.json` when asked (sanitizer caught it, but agent should refuse upfront). Rule 1 now says "do NOT read at all" instead of "refuse and explain".
- **Rule 6 - Tool output**: Agent must ALWAYS include a text response after tool calls. Never respond with only tool calls and no text.
- **Rule 7 - Sensitive output**: If a tool returns credentials, the agent must summarize without quoting sensitive values. Defense in depth with `sanitizeOutput()`.
- All 5 security rules renumbered, marked MANDATORY, expanded to 7 rules.

---

## [0.1.9] - 2026-04-13

OWASP security hardening (Phase 4) - hardening, monitoring, and best practices. Completes the full audit.

### Security

- **MarkdownV2 escaping (P4-04)**: New `escapeMarkdownV2()` properly escapes all Telegram MarkdownV2 special characters outside code blocks/inline code. Eliminates Telegram API errors on formatted messages (previously fell back to plain text silently).

### Added

- 13 new security tests: error containment (1), audit log completeness (3), MarkdownV2 escaping (4), atomic secret writes (2), SQLite WAL concurrency (3).

### Audited (confirmed safe, no code changes needed)

- **P4-01**: Telegram error handler sends only `"Something went wrong. Check the logs."` - no stack traces, paths, or error details reach the chat.
- **P4-02**: Extension logs both `tool_execution_start` and `tool_execution_end` events. Tool guard logs all denials with `security_guardrail` error type.
- **P4-06**: `writeSecret()` uses atomic temp+rename pattern with mode 0600. The `existed` check has a benign TOCTOU window (cosmetic only).
- **P4-08**: SQLite uses WAL mode for concurrent read safety. Two `MemoryIndex` instances can read the same database simultaneously.

---

## [0.1.8] - 2026-04-13

OWASP security hardening (Phase 3) - DoS prevention, supply chain, and data poisoning.

### Security

- **Per-peer rate limiter (P3-01)**: New `PeerRateLimiter` with sliding window (10 msgs/minute default). Rejects excess messages with "slow down" response.
- **Session cap (P3-02)**: Maximum 5 concurrent agent sessions across all peers. Prevents resource exhaustion from many simultaneous connections.
- **Input length validation (P3-03)**: Messages over 2000 characters rejected before reaching the agent. Prevents prompt injection hidden in long text and unnecessary token burn.
- **CVE skill scope validation (P3-05)**: Rejects `scope` argument containing shell metacharacters (`;|&$(){}`) to prevent injection via `--lockfile` flag.
- **Persona file permission check (P3-06)**: Extension warns if `operator.md` is world-writable (prompt injection risk via persona poisoning).

### Added

- `src/channels/telegram/rate-limiter.ts` - reusable sliding-window rate limiter.
- 10 new security tests: rate limiter (4), dependency pinning (2), CVE scope validation (3), routing table safety (1).

### Audited (no code changes needed)

- **P3-04**: `npm audit` returns 0 vulnerabilities. All deps use exact version pins.
- **P3-07**: `updateRoutingTable()` has zero call sites in user-facing code - safe.

---

## [0.1.7] - 2026-04-13

OWASP security hardening (Phase 2) - information disclosure, injection, and data integrity.

### Security

- **Fixed broken secret redaction (P2-01)**: `redactSecrets()` regex was non-functional (`$&` back-reference evaluated at string construction, not runtime). Rewritten with proper callback. Added patterns for Telegram bot tokens, URLs with embedded credentials, and custom auth headers (X-API-Key, X-Auth-Token).
- **SQL LIKE wildcard injection fix (P2-02)**: `searchDecisions("%")` no longer returns all rows. User input `%` and `_` characters are now escaped with `ESCAPE '\'` clause.
- **Telegram output sanitization (P2-06)**: New `sanitizeOutput()` filter runs before every Telegram reply. Redacts bot tokens, API keys, Bearer tokens, URL credentials, and `~/.mypensieve/.secrets/` paths from agent responses.
- **Config permission warning (P2-08)**: `readConfig()` now checks file permissions and warns if config.json is world-writable (could allow peer allowlist manipulation).
- **Secrets permission warning (P2-09)**: `readTelegramSecrets()` now verifies `.secrets/` dir is mode 700 and secret files are mode 600, warns on drift.

### Added

- 19 new security tests: secret redaction (9 patterns), SQL wildcard escaping (2), output sanitization (6), config permission check (1), standalone Bearer token (1).

### Changed

- `redactSecrets()` is now exported for testability.

---

## [0.1.6] - 2026-04-13

OWASP security hardening (Phase 1) + agent directory awareness.

### Security

- **Symlink path traversal fix (P1-01, P1-02)**: `checkReadAccess` and `checkWriteAccess` now use `fs.realpathSync()` instead of `path.resolve()`. Symlinks that point to denied targets (e.g. `/etc/shadow`, `~/.ssh/`) are now correctly blocked.
- **Bash guardrail evasion hardening (P1-03)**: 15 new deny patterns - absolute path sudo (`/usr/bin/sudo`), split rm flags (`rm -r -f`, `rm -fr`), `find -delete`, `dd of=/dev/`, `eval`, python/perl/node/ruby subprocess escapes, download-then-execute chains.
- **Redirect bypass fix (P1-06)**: Redirect regex now catches `>>` (append), `2>` (fd redirect), and `N>>` patterns. Added `tee`, `cp`, `mv`, `install`, `rsync`, `dd` targeting `/etc/` and `~/.ssh/` to deny patterns.
- **Peer ID validation (P1-07)**: `allowed_peers` schema now uses `z.coerce.string().regex(/^\d+$/)` - auto-coerces numbers to strings, rejects non-numeric values like `"test-peer"`.
- **Broadened .env deny pattern (P4-03)**: Changed from 3 specific patterns (`.env`, `.env.local`, `.env.production`) to catch-all `/\.env(\..+)?$/` covering all `.env.*` variants.
- **Added /proc/ and /sys/ to read deny-list (P4-07)**: Blocks reading `/proc/self/environ` (env vars with secrets), `/proc/*/maps`, `/sys/` kernel parameters.

### Added

- **Agent directory awareness**: System prompt now includes the full MyPensieve directory layout so the agent knows where persona files, config, logs, and secrets live without searching the filesystem.
- **61 new security audit tests** (`tests/unit/security-audit.test.ts`): Covers symlink traversal, bash evasion (16 vectors), redirect bypass (10 vectors), peer ID validation, path traversal regression, tool guard coverage, JSONL injection resistance, `.env` pattern completeness, `/proc/` and `/sys/` deny coverage.

### Fixed

- Test configs updated to use numeric peer IDs (required by new schema validation).

---

## [0.1.5] - 2026-04-13

Wizard cleanup - removed dead project-folder step.

### Removed

- **"Default project directory" wizard step**: Was step 2/9 but the collected value was never saved to config or used anywhere. MyPensieve is a system-wide agent OS, not project-scoped. Wizard now has 8 steps instead of 9.

### Added

- Deprecated transitive dependencies section in `KNOWN-LIMITATIONS.md` documenting `prebuild-install` and `node-domexception` warnings.

---

## [0.1.4] - 2026-04-12

Bug fixes, CI automation, and config migration layer.

### Fixed

- **Extension persona injection**: Use `before_agent_start` instead of broken context event, so persona/bootstrap prompt actually fires.
- **Telegram session handling**: Use `AgentSession.prompt()` instead of `Agent.prompt()` so extension lifecycle events fire correctly.
- **CI pipeline**: Sync lockfile, pin deps, add build tools for `better-sqlite3` native bindings.
- **Lint errors**: Resolve all Biome lint errors across the codebase.
- **Config migration**: Backward-compatible migration layer that auto-adds missing fields (`backup`, `tier_routing`) when loading older configs.

### Added

- **Renovate config**: Automated dependency PRs (dev deps auto-merge, prod deps PR-only, Pi packages disabled).
- **Pi version watcher**: Weekly Monday cron workflow that creates a GitHub issue if a Pi update is available.
- **Pre-commit hooks**: Husky + lint-staged for auto-lint on commit.
- **Trusted Publishing**: npm publish via OIDC (no token needed), uses Node 24 for native npm 11+ support.

---

## [0.1.3] - 2026-04-10

Security audit + UX polish.

### Security

- **Command injection fixes**: Replaced `execSync` string interpolation with `execFileSync` array args in `media.ts`, `security.ts`, and CLI editor.
- **Safe ffmpeg/ffprobe wrappers**: No shell interpolation for media processing commands.

### Fixed

- Readline cleanup on wizard error/abort (no dangling stdin listeners).
- Non-null assertions in wizard prompt replaced with proper defaults.

### Changed

- All 9 `"[Phase X] not yet implemented"` stub messages replaced with `"coming in v0.2.0"`.
- Removed unused `execSync` imports.

---

## [0.1.2] - 2026-04-10

Interactive wizard with real user prompts.

### Added

- **Readline-based prompt module**: `ask()`, `confirm()`, `choose()` functions for interactive terminal input.
- All 9 wizard steps now wait for user input instead of using hardcoded defaults.
- Model setup prompts for provider/model string and optional per-agent assignment.
- Channel setup asks about Telegram, prompts for bot token and peer ID.
- Persona mode selection: questionnaire, freeform, or skip.
- Review step shows full config summary with confirmation before writing.
- Abort support at review step.

---

## [0.1.1] - 2026-04-10

Wired init command to wizard, fixed ESM module issues.

### Fixed

- `require("node:path")` replaced with `import path` in `checkpoint.ts` and `framework.ts` (ESM compatibility).

### Added

- `mypensieve init` now runs the full 9-step wizard (previously a stub).
- `--restart` flag to start wizard from scratch, ignoring saved progress.

---

## [0.1.0] - 2026-04-10

Initial MVP release - autonomous agent OS with persistent memory.

### Added

- **8-verb gateway**: `recall`, `research`, `ingest`, `monitor`, `journal`, `produce`, `dispatch`, `notify` - the agent's unified tool interface.
- **5-layer cognitive memory**: Decisions, threads, persona, semantic, raw - with SQLite derived index and JSONL source of truth.
- **9 custom skills**: daily-log, memory-recall, researcher, cve-monitor, blog-seo, playwright-cli, image/video/audio-edit.
- **6 MCP configs**: datetime, playwright, duckduckgo-search, whisper-local, gh-cli, cve-intel.
- **CLI + Telegram channels**: Interactive TUI for local use, Telegram bot with long-polling for remote access.
- **Peer whitelisting**: Telegram channel restricted to explicit allowed peer IDs.
- **Council mode**: 4 agents (orchestrator, researcher, critic, devil's advocate) with shared transcript and consensus tracking.
- **Per-agent model assignment**: Any provider, any model, no hardcoded tiers.
- **Error handling**: Error dedup, circuit breakers, structured error capture with redaction.
- **Backup engine**: Configurable local/rsync backup with retention policy.
- **9-step resumable install wizard**: Operator name, timezone detection, Ollama probing, model selection, channel config, persona seeding.
- **Pi SDK integration**: Built on `@mariozechner/pi-coding-agent` v0.66.1.
- **304 tests**: Unit, integration, and end-to-end test suites.
- **GitHub CI/CD**: Test, build, lint, Snyk security audit on every push.
- **npm package**: Published as `mypensieve` with provenance attestation.

---

[0.1.14]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/HunterSreeni/MyPensieve/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/HunterSreeni/MyPensieve/releases/tag/v0.1.0
