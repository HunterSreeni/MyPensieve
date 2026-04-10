# MyPensieve - MVP Skills + MCPs Shortlist
> Locked: 2026-04-09 | Updated: 2026-04-09 (N10 gateway annotations)
> The reference shopping list for what ships at v0.1 install. Built on Pi (`@mariozechner/pi-coding-agent`).

This doc answers two pending items from the README: "Reference skill set - which 5-10 skills ship with the MVP install" and "MCP shortlist - which MCPs ship pre-registered." It captures the locked decisions from the 2026-04-09 architecture session, after research across the MCP ecosystem, the Pi reference repos, and 3 verification probes.

> **N10 update:** Per the meta-skill gateway decision (locked same day), every skill and MCP below is **gateway-routed**. The agent never invokes them directly - it calls one of 8 verbs (`recall`, `research`, `ingest`, `monitor`, `journal`, `produce`, `dispatch`, `notify`) and the gateway dispatches to the underlying skill/MCP. The "Routes via verb" column tells you which verb each skill/MCP backs. **Read META-SKILL-GATEWAY.md before this doc.**

---

## TL;DR

| Layer | Count | Notes |
|---|---|---|
| Custom skills (built by MyPensieve) | 9 | Down from the original 12 - we dropped pdf-read, web-scaffold, github-workflows |
| MCPs bundled at install | 6 | Up from 2 - we adopted 4 zero-auth MCPs we no longer have to write, plus 1 we write ourselves |
| External skill repos auto-registered | 1 mandatory + 1 recommended | `anthropics/skills` (mandatory), `badlogic/pi-skills` (recommended) |
| Pi example extensions bundled | 15 | Lifted as-is from `pi-mono/packages/coding-agent/examples/extensions/` |
| Shared Node libs | ~10 | All Node-native, zero Python runtime dependency |

**Zero OAuth flows in MVP install.** Every OAuth-bound capability (Gmail, Calendar, Drive, M365, Slack, Supabase, Netlify, generative AI) is documented as an optional v2 add-on with a clear setup path - never as a hidden requirement.

---

## Decision principles (the rules we picked things by)

These are the rules that drove the picks below. When future-you adds something to this list, follow these.

1. **Pi-blessed first.** If a skill or MCP exists in `badlogic/pi-skills` or `anthropics/skills` and meets feature parity, use it. We do not duplicate Mario or Anthropic's work.
2. **Zero-auth in MVP.** No OAuth, no PATs, no API keys for the default install. Optional auth-bound alternatives are documented in the v2 section so users see both paths.
3. **Adopt > write.** If a maintained, zero-auth MCP exists for a capability, adopt it. Only roll our own when (a) nothing exists or (b) what exists is stale, missing sources, or phones home.
4. **Node-native shared libs.** Skill-level libraries must be Node/TypeScript so they run in-process with Pi. MCP servers are process-isolated, so language doesn't matter for those - Python MCPs are acceptable.
5. **Honest scope labels.** A skill that says "SEO drafting" is more honest than one that says "keyword research" if it can't actually do volume-aware research. Don't oversell.
6. **Local binaries are fine, hosted defaults are not.** Shelling out to `ffmpeg`, `gh`, `osv-scanner`, `whisper.cpp` is fine. Adopting an MCP whose default mode phones home to a third-party server is not.

---

## MCPs (6 bundled at install)

| # | MCP | Routes via verb | Source | Auth | Why |
|---|---|---|---|---|---|
| 1 | `datetime` | (utility, available to all verbs internally) | Port from `~/.claude/mcp-servers/datetime-server.py` | None | 35-line FastMCP server. Required for cron + daily-log + any time-aware skill. Generalize the hardcoded `Asia/Kolkata` default to read from `~/.mypensieve/config.json` (`operator.timezone`) |
| 2 | `playwright` | `ingest` (when `interactive=true`) + `dispatch` (form fills) | Standard Playwright MCP | None | Browser automation. Headed by default. See `playwright-cli` skill for procedural know-how |
| 3 | `duckduckgo-search` | `research` | [nickclyde/duckduckgo-mcp-server](https://github.com/nickclyde/duckduckgo-mcp-server) | None | Search + fetch + parse, zero auth. Python MCP - acceptable since MCP servers are process-isolated. Wins over Tavily/Exa (paid) and Brave (needs free key) for the zero-auth default |
| 4 | `whisper-local` | `ingest(source='audio')` | [jwulff/whisper-mcp](https://github.com/jwulff/whisper-mcp) | None | Fully local STT via whisper.cpp. Node TS, MIT, last commit 2026-01-11. Default model `base.en` (142MB). **Linux install note:** README assumes macOS (`brew install whisper-cpp`) - on Linux operators must build whisper.cpp from source or use distro packages. Wizard documents both paths |
| 5 | `gh-cli` | `dispatch(action='gh.*')` + `monitor(target='github')` | [kousen/gh_mcp_server](https://github.com/kousen/gh_mcp_server) | None | Wraps the operator's existing `gh` CLI auth. No PAT, no Docker, no OAuth flow inside MyPensieve. Operator runs `gh auth login` once outside our scope |
| 6 | `cve-intel` | `monitor(target='cves')` + `research(topic=cve-id)` | **Custom - we write this** (~300 LOC Node MCP) | None | Direct calls to OSV.dev + NVD 2.0 + EPSS + CISA KEV. All four APIs are zero-auth, well-documented, free. **Why custom:** the leading candidate (`firetix/vulnerability-intelligence-mcp-server`) is stale (May 2025), missing GHSA + CISA KEV (2 of 5 sources we want), and its default deployment phones home to a Heroku dyno - all blockers. GHSA is documented as an optional v2 add (needs PAT) |

---

## Skills (9 custom)

| # | Skill | Routes via verb | Build status | Backed by | Notes |
|---|---|---|---|---|---|
| 1 | `daily-log` | `journal` | Custom (locked N7) | Internal MyPensieve sources only | Full-fledged - 12 source pulls, none external. See N7 spec in OPERATIONS.md and the "daily-log full-fledged spec" section below. CLI command stays `mypensieve log` for muscle memory but maps to `journal` verb internally |
| 2 | `memory-recall` | `recall` | Custom | MyPensieve memory extension (L1-L4) | Operator-invoked recall ("what did we decide about X", "show last week's wins"). Cheap and small - thin query layer over the memory extension |
| 3 | `researcher` | `research` (LLM-router exception, forced `tier_hint: cheap`) | Thin orchestration | `duckduckgo-search` MCP + `@mozilla/readability` + `jsdom` | Multi-step plan-search-read-synthesize loop. Lift loop structure from `gpt-researcher` / LangGraph `open_deep_research` - do not invent. Cite via `[n]` footnotes with URL+title+accessed-date. Always have a search backend fallback (DDG scraping breaks every few months) |
| 4 | `cve-monitor` | `monitor(target='cves'\|'packages')` | Thin wrapper | `cve-intel` MCP + `osv-scanner` CLI | Daily cron: `osv-scanner` against tracked lockfiles, diff against last run, surface deltas at CVSS >= 7.0. Ad-hoc queries: `cve-intel` MCP for CVE lookups + watchlist items. Trap to avoid: flooding - always diff, alert only on deltas, opt-in lockfile paths |
| 5 | `blog-seo` | `produce(kind='blog-post')` | Custom (~200 LOC) | `cheerio` + `flesch` + `retext-keywords` + `sitemap` + `schema-dts` | **Honest scope: "SEO-aware drafting" not "keyword research."** No free source for honest keyword volumes. Reuses `researcher`'s search backend module for SERP peeks. Yoast SEO's scoring rules are MIT and portable - lift them |
| 6 | `playwright-cli` | `ingest(source=URL, interactive=true)` + `dispatch(action='browser.*')` | Port from `~/.claude/skills/playwright-cli/` (278 lines + 7 refs) | `playwright` MCP | Capabilities: request mocking, running code, session management, storage state, test generation, tracing, video recording. **Verified:** `pi-skills/browser-tools` only covers 1.5 of these 7 - we keep the Playwright port. Stripped of Sreeni-specific content for general-purpose use. `--headed` default. `mypensieve_allowed_channels: [cli]` - never run from Telegram |
| 7 | `video-edit` | `produce(kind='video')` + `ingest(source='video')` | Custom Node TS ffmpeg wrapper | `ffmpeg` system binary | Lift the tool surface from `misbahsy/video-audio-mcp` (Python reference) but write Node-native to avoid Python runtime dep. Capabilities: format convert, trim, concat, overlay, transitions, frame extract, metadata strip |
| 8 | `audio-edit` | `produce(kind='audio')` + `ingest(source='audio')` | Custom ffmpeg wrapper + delegates transcription | `ffmpeg` + `whisper-local` MCP | Editing half = custom Node ffmpeg wrapper (trim, fade, mix, normalize, format convert). Transcription half = delegate to `whisper-local` MCP via `mcp-client` extension. No code duplication |
| 9 | `image-edit` | `produce(kind='image')` + `ingest(source='image')` (OCR) | Custom (~150 LOC) | `sharp` Node lib | Format convert (PNG/JPEG/WebP/AVIF), resize, crop, rotate, blur, sharpen, grayscale, EXIF strip (privacy), watermark, batch ops. `sharp` is faster than Pillow and Node-native. `standardbeagle/image-mcp` (80+ tools, Sharp-based) flagged as optional v1.5 power-user upgrade |

---

## External skill repos auto-registered at install

The install wizard adds these to `~/.agents/skills/` (Pi's discovery path) so the operator inherits skills without us bundling them:

### Mandatory: `anthropics/skills`

| Skill provided | Replaces our planned | Why |
|---|---|---|
| `document-skills/pdf` | **`pdf-read`** (DROPPED from our build list) | Official, maintained by Anthropic, Pi-blessed |
| `document-skills/docx` | (not in our list, free upside) | Microsoft Word reading/editing |
| `document-skills/pptx` | (not in our list, free upside) | PowerPoint |
| `document-skills/xlsx` | (not in our list, free upside) | Excel |
| `web-development/*` | (we dropped web-scaffold entirely) | Generic web dev know-how. Not used as a scaffolder, not a hard replacement |

### Recommended: `badlogic/pi-skills`

Mario Zechner's blessed skills repo. Wizard prompts the operator with "install Mario's blessed skills?" defaulting to yes.

| Skill | Use in MyPensieve | Auth |
|---|---|---|
| `browser-tools` | Lightweight alternative to `playwright-cli` for interactive sessions | None |
| `brave-search` | Optional upgrade for `researcher` if operator has a Brave free-tier key | Brave key (free 2k/mo) |
| `transcribe` | Optional cloud transcription via Groq Whisper (faster but paid) | Groq API key |
| `youtube-transcript` | Read YouTube transcripts | None |
| `vscode` | VSCode integration | None |
| `gccli`, `gdcli`, `gmcli` | Google Calendar, Drive, Mail CLIs | **OAuth** - flagged as v2 optional |

---

## Pi example extensions bundled by default

Lifted as-is from `pi-mono/packages/coding-agent/examples/extensions/` and copied into `~/.pi/agent/extensions/mypensieve-bundled/`. These are NOT new builds - they're free infrastructure we get from Pi.

| Extension | Why we ship it | Maps to |
|---|---|---|
| `subagent/` (planner.md, reviewer.md, scout.md, worker.md) | **Reference implementation for council orchestration.** Lift the role-prompt structure verbatim - do not design council from scratch | **N6** |
| `protected-paths.ts` | Block writes to sensitive paths | **N8** safety |
| `confirm-destructive.ts` | Require confirmation for destructive operations | **N8** safety |
| `permission-gate.ts` | Channel + skill allowlist gating | **N2** + our planned permission-gate extension (template) |
| `timed-confirm.ts` | Time-bounded confirmation prompts | **N8** safety |
| `notify.ts` | Notification dispatch | **N8** "4 surfacing channels" |
| `event-bus.ts` | In-process event pub/sub | **N8** surfacing infra |
| `auto-commit-on-exit.ts` | Auto-commits at session end | Local git hygiene (replaces local-git half of github-workflows) |
| `git-checkpoint.ts` | Git safety checkpoints during sessions | Local git hygiene |
| `dirty-repo-guard.ts` | Block destructive ops on dirty repos | Local git hygiene |
| `file-trigger.ts` | File-watcher-triggered behaviors | **N9** backup cron pattern |
| `handoff.ts` | Session handoff notes generation | **L1** seed for next session (MEMORY-ARCHITECTURE.md) |
| `session-name.ts` | Auto-name sessions | Session manager |
| `custom-compaction.ts` | Pluggable compaction logic | L2 distillation hook |
| `summarize.ts`, `trigger-compact.ts` | Compaction triggers | L2 distillation hook |

**That's 15 extensions for free.** None of them are new MyPensieve work - they're a `cp -r` from Pi's examples directory at install time, version-locked to our pinned Pi version.

---

## Shared Node libs (in-process, used by skills)

| Lib | Used by | Why |
|---|---|---|
| `sharp` | image-edit | Faster than Pillow, Node-native, well-maintained |
| `vega-lite` (or vega-lite CLI) | daily-log trend charts, weekly-review | Matplotlib-quality output, no Python |
| `mermaid` + `jsdom` | daily-log digests, weekly-review, project state visualizations | **SVG output, no Puppeteer needed** - kills the heaviest dep we'd otherwise pull in (~300MB chromium). PNG output deferred to v1.5 |
| `cheerio` | blog-seo, researcher | HTML parsing |
| `flesch` (text-readability) | blog-seo | Readability scoring |
| `retext-keywords` + `retext-english` | blog-seo | Keyword extraction |
| `sitemap` | blog-seo | sitemap.xml generation |
| `schema-dts` | blog-seo | JSON-LD structured data |
| `@mozilla/readability` + `jsdom` | researcher, blog-seo | Web content extraction |
| `duck-duck-scrape` | researcher fallback | Backup search backend if `duckduckgo-search` MCP is unavailable |

**System binaries** (operator must have installed): `ffmpeg`, `whisper.cpp`, `osv-scanner`, `gh`, `git`, `node` ≥20, `python` ≥3.10 (only if `duckduckgo-search` MCP is enabled).

---

## Optional v2 add-ons (OAuth or paid - documented for users)

The wizard's `Optional integrations` phase shows operators these. Each is fully opt-in. Setup writes to `~/.mypensieve/integrations/<name>.json` and patches the relevant skill's `sources` list (e.g. daily-log auto-pulls calendar context once Calendar is enabled).

### OAuth-bound communications

| Integration | What it adds | Auth | What it enables |
|---|---|---|---|
| Gmail | Email reading + triage | Google OAuth | Daily-log can pull "today's email summary"; new `email-triage` skill |
| Google Calendar | Tomorrow's events | Google OAuth | Daily-log can pull "tomorrow's calendar" for the remember-tomorrow question |
| Google Drive | File access | Google OAuth | New `drive-search` skill |
| Microsoft 365 | M365 mail/calendar/files | M365 OAuth | New `m365-*` skill family |
| Slack | Channel mentions + DMs | Slack OAuth | Daily-log can pull "today's mentions"; new `slack-triage` skill |

### Token-based developer integrations

| Integration | What it adds | Auth | What it enables |
|---|---|---|---|
| Supabase | Project access | Supabase PAT | Database query + migrations |
| Netlify | Deployment | Netlify PAT | New `web-deploy` skill |
| GitHub (richer) | Cross-repo + org operations | GitHub PAT | Replaces `gh-cli` MCP if operator wants richer than CLI surface |
| GitHub Security Advisories | Adds GHSA to cve-intel | GitHub PAT | 5th source for `cve-monitor` |

### Search / quality upgrades

| Integration | What it adds | Auth |
|---|---|---|
| Brave Search | Higher-quality search backend | Brave free-tier key (no OAuth) |
| `pi-skills/transcribe` (Groq) | Faster cloud transcription | Groq API key |
| Tavily / Exa | Premium research APIs | Paid keys |

### Generative AI (paid + heavy)

| Integration | What it adds | Auth |
|---|---|---|
| Image generation (DALL-E, Flux) | New `image-generate` skill | OpenAI/Replicate key |
| Video generation (Runway, Veo, Sora) | New `video-generate` skill | Provider API key |
| Audio generation (ElevenLabs, Suno) | New `audio-generate` skill | Provider API key |

---

## Daily-log full-fledged spec (closes the N7 expansion question)

`daily-log` is the highest-leverage skill in MVP. Per the previous session's clarification, it must be **fully self-contained with zero external MCP dependency.** All sources are internal MyPensieve state or local binaries the operator already has installed (`gh`, `git`).

### Source list (all internal)

```yaml
mypensieve_sources:
  internal:
    - decisions          # MyPensieve decision extractor
    - sessions           # Pi session JSONL
    - cost               # cost-tracking extension
    - errors             # N8 error log
    - reminders          # cron reminders state
    - threads            # L3 thread layer
    - blockers           # yesterday's daily-log blockers carry-over
    - trends             # SQLite mood/energy 7d/30d
    - backup_status      # N9 backup state file
    - project_state      # active project state.md
  local_binary:
    - git_activity       # gh CLI (already installed)
    - github_prs         # gh CLI
    - filesystem_diff    # opt-in via config.daily_log.tracked_dirs
  external_optional_v2:  # disabled in MVP, enabled by v2 wizard if operator opts in
    - calendar_tomorrow  # Google Calendar OAuth
    - email_triage       # Gmail OAuth
    - slack_activity     # Slack OAuth
```

### File layout

```
~/.pi/agent/skills/daily-log/
  ├── SKILL.md                  # frontmatter + 6-question prompt template
  ├── prompts/
  │   ├── morning-missed.md     # "you didn't log yesterday, want to now?"
  │   └── evening.md            # the 6-question template
  └── lib/
      ├── gather-context.ts     # pre-prompt source aggregator
      ├── format-digest.ts      # builds the context block (markdown + vega-lite + mermaid SVG embeds)
      ├── append-entry.ts       # writes to daily-logs.jsonl + digest_snapshot
      ├── trends.ts             # SQLite query for 7d/30d mood/energy
      └── carry-forward.ts      # reads yesterday's blockers + remember-tomorrow
```

### SQLite trends index

```sql
CREATE TABLE daily_logs (
  id TEXT PRIMARY KEY,
  ts INTEGER,
  project TEXT,
  mood INTEGER,
  energy INTEGER,
  weekly_review_flag INTEGER,
  wins TEXT,
  blockers TEXT,
  remember_tomorrow TEXT
);
CREATE INDEX idx_daily_logs_project_ts ON daily_logs(project, ts);
```

Rebuilt from `~/.mypensieve/projects/<active>/daily-logs.jsonl` if dropped (drop-and-reindex pattern, consistent with N5 invariant).

### Cron + CLI

- `20:00` local cron → `mypensieve log` (the 6-question evening prompt)
- `08:00` local cron → `mypensieve log --check-missed` (non-nagging morning surfacer)
- `mypensieve log` - manual trigger
- `mypensieve log --yesterday` - log a missed yesterday entry
- `mypensieve trends mood --days 30` - vega-lite chart of mood over 30d
- `mypensieve trends energy --days 30` - vega-lite chart of energy over 30d
- `mypensieve review` - weekly review flow (uses `weekly_review_flag` history)

### Outputs

The skill writes back into the memory layer:
- `daily-logs.jsonl` entry (source of truth)
- New thread in L3 if `remember_tomorrow` is non-empty (auto-loaded into tomorrow's L2)
- Decision in L2 if `weekly_review_flag` is true
- SQLite trends row
- `~/.mypensieve/state/last-daily-log` for the morning missed-check

### Visual outputs

- **Trend charts:** vega-lite → SVG, embedded in the digest the next morning
- **Decision timelines:** mermaid → SVG via `mermaid` + `jsdom`, embedded in weekly review
- **Thread relationship graphs:** mermaid → SVG, embedded in weekly review
- **PNG output:** deferred to v1.5 (would need puppeteer or resvg)

---

## What got dropped from earlier drafts and why

| Item | Original plan | Why dropped |
|---|---|---|
| `pdf-read` skill | Custom skill using pdf-parse / pdfjs-dist | `anthropics/skills/document-skills/pdf` already exists. Drop our build, point at theirs |
| `web-scaffold` skill | Shell out to `create-*` CLIs | Sreeni's call (2026-04-09): no skill/MCP scaffolding bridge needed in MVP. Operators can `npx create-X` directly |
| `github-workflows` skill | Wrap gh CLI workflows | Replaced by `gh-cli` MCP (kousen) + Pi git extensions for local. Two cleaner layers, no skill-level wrapper needed |
| `firetix/vulnerability-intelligence-mcp-server` | Adopt as cve-intel MCP | Stale (last commit May 2025), missing GHSA + CISA KEV, defaults to phoning home to a Heroku dyno. We write our own ~300 LOC Node MCP instead |
| `pi-skills/browser-tools` (as Playwright replacement) | Drop our 278-line Playwright port and use it instead | Verified: covers only 1.5 of 7 needed capabilities (eval + partial cookies). Missing request mocking, multi-session, storage state save/load, tracing, video recording, test generation. Keep our Playwright port |
| Python runtime for shared libs | matplotlib + Pillow | Sreeni locked Node-native (sharp + vega-lite). Python only allowed for process-isolated MCP servers, not in-process libs |
| `puppeteer` + headless chromium | For mermaid PNG rendering | mermaid + jsdom can produce SVG without a headless browser. SVG is enough for MVP. PNG deferred to v1.5 |

---

## Forward-compat hooks (what wires up cleanly when v2 lands)

These are the seams we leave open in v0.1 so v2 doesn't require rewrites:

1. **Skill `sources` frontmatter** with `external_optional_v2` keys - daily-log already has the calendar/email/slack hooks declared, just disabled. v2 setup wizard patches the disabled list.
2. **`mypensieve integrations add <name>` command** - placeholder in MVP CLI, fully implemented in v2 wizard.
3. **MCP registry at `~/.mypensieve/mcps/`** - structure supports adding new MCPs at any time. v2 just appends.
4. **GHSA-as-5th-source for cve-intel** - MCP code has the GHSA call path stubbed out behind a `GITHUB_TOKEN` env check. Operator sets the env var to enable it; no code change.
5. **Mermaid PNG output** - mermaid lib is already in shared deps; v1.5 just adds the optional renderer (puppeteer or resvg) behind a config flag.
6. **Brave Search upgrade for researcher** - researcher skill has a search-backend abstraction; switching from DDG to Brave is a config change, not a code change.

---

## Open questions for implementation time

These don't block the lock - they're things to confirm during the first implementation pass.

1. **Linux install path for `whisper.cpp`** - the wizard needs to handle 3 cases: (a) operator already has it, (b) `apt`/`pacman` package available, (c) build from source. Document all 3.
2. **`osv-scanner` install** - similar - verify Go binary distribution channels for major distros, fall back to "operator installs themselves."
3. **`anthropics/skills` discovery in Pi** - confirm Pi 0.x picks up skills from `~/.agents/skills/anthropics-skills/document-skills/pdf/SKILL.md` correctly, or if we need a flatter layout.
4. **vega-lite → SVG in Node** - test that vega-lite-cli can produce SVG from JSON spec without requiring a JSDOM polyfill we forgot about.
5. **mermaid + jsdom rendering** - quick smoke test of `mermaid.render()` in jsdom to confirm SVG output works without headless browser.
6. **Python availability for `duckduckgo-search` MCP** - wizard checks `python3 --version` and either: (a) installs the MCP via uvx, (b) skips if Python missing and falls back to `duck-duck-scrape` Node lib in the researcher skill.

---

## Reference: source repos and links

| Item | Link |
|---|---|
| Pi monorepo | https://github.com/badlogic/pi-mono |
| Pi skills (Mario) | https://github.com/badlogic/pi-skills |
| Anthropic skills | https://github.com/anthropics/skills |
| nickclyde/duckduckgo-mcp-server | https://github.com/nickclyde/duckduckgo-mcp-server |
| jwulff/whisper-mcp | https://github.com/jwulff/whisper-mcp |
| kousen/gh_mcp_server | https://github.com/kousen/gh_mcp_server |
| osv-scanner (Google) | https://github.com/google/osv-scanner |
| OSV.dev API | https://api.osv.dev |
| NVD API v2 | https://nvd.nist.gov/developers/vulnerabilities |
| EPSS API (FIRST) | https://www.first.org/epss/api |
| CISA KEV catalog | https://www.cisa.gov/known-exploited-vulnerabilities-catalog |
| gpt-researcher (loop reference) | https://github.com/assafelovic/gpt-researcher |
| LangGraph open_deep_research | https://github.com/langchain-ai/open_deep_research |
| Mozilla Readability | https://github.com/mozilla/readability |
| sharp (image lib) | https://github.com/lovell/sharp |
| vega-lite | https://vega.github.io/vega-lite/ |
| mermaid | https://github.com/mermaid-js/mermaid |
| misbahsy video-audio-mcp (Python ref) | https://github.com/misbahsy/video-audio-mcp |
| standardbeagle image-mcp (v1.5 upgrade) | https://github.com/standardbeagle/image-mcp |
