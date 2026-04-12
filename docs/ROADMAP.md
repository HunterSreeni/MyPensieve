# MyPensieve - Roadmap
> Last updated: 2026-04-12
> Sources: architecture docs, memory files, implementation plan, skills shortlist, PATRONUS draft

---

## Current State (v0.1.3)

- npm package deprecated (not ready for production)
- 329 tests passing, CI/CD active
- 10-step interactive wizard with real readline prompts
- Agent persona system (3-layer hybrid: template + wizard + first-run bootstrap)
- Operator persona template (scaffolded during init)
- Telegram listener (grammy, long-polling, allowlist, per-peer sessions)
- Filesystem security guardrails (read-deny / write-allow / bash filtering)
- Ollama Cloud provider wired (nemotron-3-super:cloud tested)
- Pi extension bridge installed and loading

---

## v0.2.0 - "Pi Interactive + Core Skills"

**Theme:** The agent actually works end-to-end. Memory, skills, gateway routing, council mode.

| # | Feature | Source | Status |
|---|---------|--------|--------|
| 1 | Memory extraction - nightly JSONL extractor (L1-L4 layers) | IMPLEMENTATION-PLAN Phase 3 | Not started |
| 2 | Decision detection - manual + auto from sessions | MEMORY-ARCHITECTURE | Not started |
| 3 | Council mode - multi-agent deliberation (orchestrator, researcher, critic, devil-advocate) | MULTI-AGENT-RUNTIME | Framework in TS, not wired to CLI |
| 4 | Council persona split - protocol in TS, personality in editable .md | Confirmed 2026-04-12 | Design locked |
| 5 | 8-verb gateway wiring - recall/research/ingest/monitor/journal/produce/dispatch/notify | META-SKILL-GATEWAY + Phase 2 | Dispatcher + routing built, not connected to real skills |
| 6 | Daily-log skill - 12 internal sources, 6-question prompt, SQLite trends | SKILLS-MCP-SHORTLIST | Not started |
| 7 | Memory-recall skill - thin query layer over L1-L4 | SKILLS-MCP-SHORTLIST | Not started |
| 8 | Researcher skill - DDG search + readability + synthesize loop | SKILLS-MCP-SHORTLIST | Not started |
| 9 | CVE-monitor skill - osv-scanner + custom cve-intel MCP | SKILLS-MCP-SHORTLIST | Not started |
| 10 | Real MCP connections - datetime, playwright, duckduckgo-search, whisper-local, gh-cli, cve-intel | SKILLS-MCP-SHORTLIST | Not started |
| 11 | Persona seeding modes - questionnaire + freeform (currently stubbed as "skip") | Wizard steps.ts | Stubs exist |
| 12 | Agent persona loadout - multiple profiles, switchable | v020_backlog memory | Not started |
| 13 | Security guardrails full enforcement - bash arg parsing improvements, edge cases | agent_security_policy.md | Basic version shipped |
| 14 | Wizard TUI upgrade - arrow-key lists, radio, checkbox, color coding | ux_upgrade_backlog memory | Deferred until E2E works |
| 15 | Pi extension bundling - 15 Pi example extensions auto-installed | SKILLS-MCP-SHORTLIST | Not started |
| 16 | Pi re-audit - run scripts/pi-reaudit.sh | project_status memory | Pending 2026-04-13 |
| 17 | Gateway audit log - log every verb invocation | IMPLEMENTATION-PLAN Phase 2 | Not started |
| 18 | Telegram E2E validation - actual message->response flow tested | Built 2026-04-12 | Needs E2E test |
| 19 | Fresh Ollama install test - destructive first-user-experience test | test_list memory | Awaiting confirmation |
| 20 | Daemon management - `mypensieve daemon install/uninstall/status` | Confirmed 2026-04-12 | Stub exists |
| 21 | Multi-OS service support - systemd (Linux), launchd (macOS), Windows service | Confirmed 2026-04-12 | Not started |
| 22 | Self-healing - agent reads own error log, suggests/applies fixes (`mypensieve recover`) | Confirmed 2026-04-12 | Stub exists |
| 23 | Error context injection - wire recent errors into agent's system prompt for self-diagnosis | Confirmed 2026-04-12 | Not started |

### v0.2.0 Architecture: Cross-OS + In-Process Scheduling (locked 2026-04-12)

**The always-on process IS the scheduler.** No system crontab needed.

All cron-like jobs (daily-log, extractor, backup) run in-process within `mypensieve start`.
This is fully cross-OS with zero platform-specific code for scheduling.

| What | How | OS-specific? |
|------|-----|--------------|
| Cron scheduling | In-process (`cron` package, timezone-aware) | No - pure JS |
| Telegram bot | grammy long-polling | No - pure network |
| CLI sessions | Pi InteractiveMode | No - stdio |
| File permissions | chmod on Unix, skip on Windows | Thin abstraction |
| Daemon (auto-start) | systemd / launchd / Windows Service | Yes - v0.2.0 |
| Config paths | `os.homedir()` + `path.join()` | No - Node handles it |

### v0.2.0 Design Decisions (locked)

- **Council persona split:** Each council agent has hardcoded protocol layer (phases, structured channels, consensus) in TypeScript + editable personality layer (tone, strictness, focus) in `~/.mypensieve/persona/<agent-name>.md`. Template-first pattern.
- **Security model:** Hybrid option 3 - read deny-list + write allow-list. Enforced via Pi's `beforeToolCall` hook. Critical for unattended Telegram channel.
- **No hardcoded models anywhere.** Operator picks freely. grep for model strings before shipping.
- **Cross-phase integration testing required** between every consecutive pair of phases.

---

## v0.3.0 - "Real MCPs + Content Production"

**Theme:** External tool integrations ship. Content creation skills. Multi-provider support.

| # | Feature | Source |
|---|---------|--------|
| 1 | Blog-SEO skill - cheerio + flesch + retext-keywords + schema-dts | SKILLS-MCP-SHORTLIST |
| 2 | Video-edit skill - Node ffmpeg wrapper (format, trim, concat, overlay) | SKILLS-MCP-SHORTLIST |
| 3 | Audio-edit skill - ffmpeg + whisper-local delegate | SKILLS-MCP-SHORTLIST |
| 4 | Image-edit skill - sharp (resize, crop, format, watermark, EXIF strip) | SKILLS-MCP-SHORTLIST |
| 5 | Playwright-CLI skill - port from ~/.claude/skills/ (7 capabilities) | SKILLS-MCP-SHORTLIST |
| 6 | Multi-provider support - beyond Ollama (OpenRouter, Anthropic, OpenAI) | PROVIDERS.md |
| 7 | External skill repos - auto-register anthropics/skills + badlogic/pi-skills | SKILLS-MCP-SHORTLIST |
| 8 | L4 semantic search - embedding-based recall with nomic-embed-text | MEMORY-ARCHITECTURE |
| 9 | Mermaid + vega-lite visuals - SVG charts for daily-log and weekly review | SKILLS-MCP-SHORTLIST |
| 10 | Weekly review flow - `mypensieve review` command | daily-log spec |
| 11 | Trends CLI - `mypensieve trends mood/energy --days 30` | daily-log spec |
| 12 | Backup engine - local + rsync, retention, cron | OPERATIONS.md |
| 13 | Recovery engine - automated recovery for unresolved errors | OPERATIONS.md |
| 14 | Custom skill registration - operator-defined skills via YAML routing | IMPLEMENTATION-PLAN Phase 2 |
| 15 | MCP registry - `~/.mypensieve/mcps/` structure, add/remove MCPs | SKILLS-MCP-SHORTLIST |

### v0.3.0 Design Notes

- **Node-native shared libs only.** Python allowed only for process-isolated MCP servers, never in-process.
- **System binaries are fine:** ffmpeg, whisper.cpp, osv-scanner, gh, git. Wizard checks availability.
- **sharp over Pillow.** vega-lite over matplotlib. mermaid+jsdom over puppeteer for SVG.
- **Search backend abstraction** in researcher skill - switching DDG to Brave is a config change, not code change.

---

## v0.4.0 - "Wizard Prompts + Polish"

**Theme:** First-impression UX. Wizard feels modern. Operator documentation complete.

| # | Feature | Source |
|---|---------|--------|
| 1 | Full TUI library integration (@clack/prompts or similar) | ux_upgrade_backlog memory |
| 2 | Arrow-key navigable list selections | ux_upgrade_backlog memory |
| 3 | Radio (single-select) + checkbox (multi-select) components | ux_upgrade_backlog memory |
| 4 | Persistent completed-step state above current question | ux_upgrade_backlog memory |
| 5 | Inline validation feedback | ux_upgrade_backlog memory |
| 6 | Color coding: green success, yellow warning, red error | ux_upgrade_backlog memory |
| 7 | `mypensieve integrations add <name>` command | SKILLS-MCP-SHORTLIST forward-compat |
| 8 | Operator-facing documentation (usage guide, config reference) | - |
| 9 | Contribution guide for skill authors | - |

---

## v1.0.0 - "Stable"

**Theme:** Production-ready. No more breaking changes. Public install.

| # | Feature | Source |
|---|---------|--------|
| 1 | All Phase 1-10 exit criteria green (unit, integration, E2E, security) | IMPLEMENTATION-PLAN |
| 2 | Full security audit (OWASP, command injection, prompt injection) | session_feedback memory |
| 3 | Config schema frozen (SemVer guarantees) | release_process memory |
| 4 | npm undeprecated, public install instructions restored | project_status memory |
| 5 | Pi version compatibility matrix documented | PI-FOUNDATION.md |
| 6 | Performance profiling - session start < 3s, memory load < 500ms | - |
| 7 | Error recovery for all critical paths | OPERATIONS.md |

---

## v2.0.0 - "Patronus + Open Contributions"

**Theme:** The friend agent. OAuth integrations. Community ecosystem.

| # | Feature | Source |
|---|---------|--------|
| 1 | **Patronus agent** - the friend, not the productivity tool. Reads SREENI.md + memory layer. Pushes back on self-deprecation. Knows what restores you. | docs/drafts/PATRONUS.md |
| 2 | OAuth integrations - Gmail, Google Calendar, Google Drive, Slack, M365 | SKILLS-MCP-SHORTLIST v2 |
| 3 | Token-based integrations - Supabase, Netlify, GitHub PAT, GHSA (5th CVE source) | SKILLS-MCP-SHORTLIST v2 |
| 4 | Search upgrades - Brave (free tier), Tavily, Exa (paid) | SKILLS-MCP-SHORTLIST v2 |
| 5 | Generative AI skills - DALL-E/Flux (image), Runway/Veo (video), ElevenLabs/Suno (audio) | SKILLS-MCP-SHORTLIST v2 |
| 6 | PNG chart output - puppeteer or resvg for mermaid/vega-lite | SKILLS-MCP-SHORTLIST |
| 7 | Open contribution model - community skills, MCPs, extensions | release_process memory |
| 8 | Patronus activation triggers - mood detection from daily-log trends, drift detection from thread staleness | PATRONUS.md |

---

## Principles (apply to all versions)

1. **No hardcoded models.** Operator picks freely, per agent.
2. **Zero-auth in default install.** OAuth/PATs are always opt-in v2 add-ons.
3. **Template-first for all .md files.** Nothing scaffolded is ever empty.
4. **Test before ship.** Local build + full user flow before npm publish. Always.
5. **Cross-phase integration tests.** Every consecutive pair of phases gets tested together.
6. **Node-native shared libs.** Python only for process-isolated MCP servers.
7. **8-verb gateway is the security boundary.** Agent never sees raw skill/MCP names.
8. **Adopt > write.** If a maintained zero-auth tool exists, use it. Don't duplicate.
9. **Honest scope labels.** Don't oversell what a skill can do.
10. **Local binaries fine, hosted defaults not.** Shell out to ffmpeg/gh/osv-scanner is OK. Phoning home to third-party servers by default is not.
