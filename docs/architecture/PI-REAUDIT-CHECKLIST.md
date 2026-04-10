# Pi Re-Audit Checklist
> Created: 2026-04-09 | Status: Ready to run on 2026-04-13
> Companion: `scripts/pi-reaudit.sh` (run-it-yourself audit script)

This is the post-freeze re-audit. Pi (`@mariozechner/pi-coding-agent`) is in OSS Weekend freeze until Monday 2026-04-13. Mario said "i'm deep in refactoring internals, and need to focus" - the refactor lives on a private branch and is expected to land around or shortly after April 13. We pin Pi as the load-bearing foundation per N5, so anything that changes about the public surface, the extension API, the RPC protocol, or session services has the potential to break our 13 locked decisions.

This checklist tells you exactly what to look at, what to flag, and what decisions to revisit if specific things have changed.

---

## Pre-audit baseline (snapshot taken 2026-04-09)

| Item | Value |
|---|---|
| Freeze status file | `.github/oss-weekend.json` → `active: true, reopensOn: "2026-04-13"` |
| Last commit before audit | `3b7448d` - "fix(tui): replace spread-into-push in Container.render() to prevent stack overflow" |
| Pinned `@mariozechner/pi-coding-agent` version (current) | **0.66.1** |
| Repo path on disk | `/tmp/pi-mono` |
| Reference doc | `PI-FOUNDATION.md` (the load-bearing decision) |

**Save this baseline.** The audit script captures these as `baseline.json` so you can diff against the post-freeze state.

---

## When to run

**Earliest:** Monday 2026-04-13 morning (the day the freeze nominally ends).
**Latest acceptable:** within 48 hours of the freeze ending - any longer and the refactor gap grows.
**Repeat trigger:** any time `@mariozechner/pi-coding-agent` minor version bumps in the npm registry, even after MVP ships.

Before running, confirm the freeze actually ended:
```
curl -sS https://raw.githubusercontent.com/badlogic/pi-mono/main/.github/oss-weekend.json
```
If `active: false` or `reopensOn` has slipped to a later date, postpone the audit accordingly.

---

## Surface watch list

These are the specific files and concepts to inspect. The audit script automates the diffs - this section is what to look for in the output.

### 1. Public SDK surface

| File | What to check | Why |
|---|---|---|
| `packages/coding-agent/src/index.ts` | Exported names removed, renamed, or re-typed | Anything we import from `@mariozechner/pi-coding-agent` lives here. A removed export = a build break for MyPensieve |
| `packages/coding-agent/src/core/sdk.ts` | `createAgent()` and friends - signature changes | This is how we embed Pi. Signature changes ripple into our channel adapters |

**Decision risk if changed:** N5 (Pi as foundation) - the embed pattern itself.

### 2. AgentSession runtime (the loop)

| File | What to check | Why |
|---|---|---|
| `packages/coding-agent/src/core/agent-session.ts` (currently 3059 lines) | Existence and shape of `AgentSession`. Any new `AgentSessionRuntime` class. New `createAgentSessionServices` factory. | Mario hinted at a refactor that may split AgentSession into a runtime + services factory. Channel adapters use in-process AgentSession (per pi-mom pattern) - if this splits, the adapter pattern needs updating |
| `packages/coding-agent/src/modes/rpc/rpc-mode.ts` (`runRpcMode` defined at line 46, exported at index.ts:301) | Function signature, exit semantics, message protocol | RPC mode is the optional process-isolation alternative to in-process. We documented it as stable - confirm still exported and signature unchanged |

**Decision risk if changed:** N5 channel adapter pattern (in-process default, RPC optional).

### 3. Extension API contract

| File | What to check | Why |
|---|---|---|
| `packages/coding-agent/src/core/extensions/types.ts` | Hook names, signatures, lifecycle event types. New hooks added? Any removed? | MyPensieve ships ~9 extensions (memory, projects, channel-binding, mcp-client, council, cost-tracking, decision-extractor, persona-injector, permission-gate) - all bound to this contract |
| `packages/coding-agent/examples/extensions/` | New examples added? Any examples we lifted have been changed? | We bundle 15 example extensions verbatim (subagent, protected-paths, confirm-destructive, permission-gate, timed-confirm, notify, event-bus, auto-commit-on-exit, git-checkpoint, dirty-repo-guard, file-trigger, handoff, session-name, custom-compaction, summarize, trigger-compact). If any were updated, we sync the bundled copies |

**Decision risk if changed:** N5 (extension bundle), N6 (subagent reference for council), N8 (safety templates).

### 4. Session manager + JSONL trees

| File | What to check | Why |
|---|---|---|
| `packages/coding-agent/src/core/session-manager.ts` | Session JSONL schema, branch/fork API, resume/migration logic | MyPensieve's raw layer = Pi's session JSONL. Schema changes mean our extractor has to re-parse |
| `packages/coding-agent/src/core/auth-storage.ts` | `AuthStorage` interface, file location (`~/.pi/agent/auth.json`), refresh hook | We delegate AI auth to Pi entirely. Any structural change here affects N3 (config layout) and the OAuth refresh story |

**Decision risk if changed:** N3 (config layout), MEMORY-ARCHITECTURE.md L0/raw layer assumptions.

### 5. Skills system

| File | What to check | Why |
|---|---|---|
| `packages/coding-agent/src/core/skills.ts` | `formatSkillsForPrompt` lazy catalog logic, frontmatter schema, skill discovery paths | N2 says skills are Pi-native single SKILL.md files. Pi handles the lazy catalog. If the discovery rules or frontmatter shape change, our 9 custom skills' frontmatter may need updating |
| `packages/coding-agent/docs/skills.md` | Skill discovery paths, especially `~/.pi/agent/skills/`, `~/.agents/skills/`, `.pi/skills/` | The auto-registration of `anthropics/skills` and `badlogic/pi-skills` depends on these paths being stable |

**Decision risk if changed:** N2 (skill model), SKILLS-MCP-SHORTLIST.md auto-registration plan.

### 6. Provider abstraction (`pi-ai`)

| File | What to check | Why |
|---|---|---|
| `packages/ai/src/providers/` | New providers added? Any removed? `KnownProvider` enum changes? | N4 says provider abstraction is Pi's responsibility. New providers = free upside for our routing layer |
| `packages/ai/src/utils/oauth/anthropic.ts` | Anthropic OAuth refresh logic | Our N3 / OAuth refresh story (still pending in MVP decisions) depends on this |
| `packages/ai/src/providers/openai-completions.ts` | Compat shim - any changes to baseUrl handling, header passing, overflow detection | OpenRouter, Ollama (local + cloud), Groq, Together, Fireworks all ride this. PROVIDERS.md verified Ollama Cloud `/v1` works through this shim 2026-04-09 - confirm still works post-freeze |

**Decision risk if changed:** N4 (provider abstraction), PROVIDERS.md routing function.

### 7. Documentation churn

| File | What to check |
|---|---|
| `packages/coding-agent/docs/sdk.md` | SDK examples - if examples changed shape, the patterns we lifted from `examples/extensions/handoff.ts:99-103` for the council `complete()` call may need updating |
| `packages/coding-agent/docs/extensions.md` | Extension authoring guide |
| `packages/coding-agent/docs/rpc.md` | RPC mode protocol |
| `packages/coding-agent/AGENTS.md` | Agent metadata format |
| `packages/coding-agent/CHANGELOG.md` (if exists) | Headline changes between 0.66.1 and current |

---

## Outcome buckets

Based on what the audit reveals, classify the result and act accordingly.

| Bucket | Criteria | Action |
|---|---|---|
| **Green** | No public surface changes. Patch-level version bump only. New examples, new providers, doc tidy. | Bump pinned version in MyPensieve, sync the 15 bundled example extensions if any changed, no decision changes |
| **Yellow** | New extension hooks added (additive). New providers. RPC protocol additions but no removals. AgentSession internal refactor that doesn't change the public class shape | Bump pinned version, audit each MyPensieve extension against the new hook list (do we want to subscribe to new ones?), no decision changes |
| **Orange** | Public surface renamed (e.g. `AgentSession` → `AgentSessionRuntime`), new factory pattern (`createAgentSessionServices`), extension API additions that affect lifecycle ordering, RPC protocol changes | Update channel adapter pattern, update PI-FOUNDATION.md with the new shape, possibly amend N5 to call out the new factory, no other decision changes. Plan a 1-2 day adapter rewrite |
| **Red** | Public surface removed without replacement, extension API breaking changes, session JSONL schema break, AuthStorage location change, skill discovery paths changed, RPC mode removed | **Halt implementation.** Re-walk affected decisions (N5 always, plus whichever others). Decide whether to pin to pre-refactor version and wait for stabilization, or accept the break and rewrite |

**Default expectation:** Yellow or Orange. Mario's blog post explicitly values stability and his refactor reason ("deep in refactoring internals") suggests internal cleanup, not public-surface removal. Red is unlikely but possible if the refactor was bigger than telegraphed.

---

## Post-audit actions (for any non-Green outcome)

For each thing the audit flags, walk through:

1. **Which MyPensieve doc references it?** Update the doc with the new shape.
2. **Which locked decision (1-3, N1-N9) is affected?** If a decision needs amending, that is itself a new locked decision - do not silent-drift.
3. **Which extensions/skills/MCPs need code changes?** Add to the implementation backlog.
4. **What is the new pinned version?** Update `package.json` reference and PI-FOUNDATION.md version table.
5. **Should the bundled example extensions be re-synced?** If yes, run `scripts/sync-bundled-extensions.sh` (to be written at implementation time).

Record the audit outcome in `~/.mypensieve/decisions/<date>-pi-reaudit.md` once MyPensieve is implemented. Until then, just append a one-paragraph note to PI-FOUNDATION.md under a "Re-audit history" section.

---

## How to run

```
cd /home/huntersreeni/Documents/Sreeniverse/MyPensieve
./scripts/pi-reaudit.sh
```

The script:
1. Confirms the freeze is over (or warns if still active)
2. Updates the local `/tmp/pi-mono` clone (clones if missing)
3. Records the post-freeze HEAD commit
4. Diffs each watch-list file against the baseline commit (`3b7448d`)
5. Lists new files in `examples/extensions/` and `packages/ai/src/providers/`
6. Prints the new `@mariozechner/pi-coding-agent` version
7. Outputs a summary report at `scripts/pi-reaudit-report-<date>.md`

The report is the input to the "outcome buckets" classification above. **It does not auto-classify** - a human reads it, decides bucket, takes action.

---

## What this audit does NOT do

- Does not update MyPensieve source code (we have none yet)
- Does not modify the pinned Pi version automatically
- Does not run Pi's test suite (do that in a separate step if needed)
- Does not check Mario's Discord for refactor announcements - manual step
- Does not check the npm registry for the new version - the script does this last

---

## Reference

- Baseline commit `3b7448d` (current HEAD as of 2026-04-09)
- Pinned version 0.66.1
- Freeze ends 2026-04-13 (Monday)
- N5 design intent anchors:
  - Mario Zechner - "What I learned building an opinionated and minimal coding agent" - https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
  - Cognition - "Don't Build Multi-Agents" - https://cognition.ai/blog/dont-build-multi-agents
- Pi monorepo: https://github.com/badlogic/pi-mono
- Discord (for refactor announcements): https://discord.com/invite/3cU7Bz4UPx
