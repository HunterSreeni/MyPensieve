# MyPensieve - Pipeline & Automation Architecture
> Created: 2026-04-12 | Maintainer: Sreeni
> Goal: Automate everything that doesn't need a human brain. Save sessions for things that do.

---

## Current State (what exists today)

| Pipeline | Tool | Status |
|----------|------|--------|
| CI (test + build + lint) | GitHub Actions | Working |
| Security scan | Snyk + npm audit | Working |
| npm publish | GitHub Actions (on tag) | Working |
| Dependency updates | None | Manual |
| Pre-commit hooks | None | Manual |
| Changelog | None | Manual |
| Release process | Manual version bump + tag | Manual |
| Code coverage | None | Not tracked |

---

## Target State (fully automated pipeline)

```
Developer pushes code
        |
        v
[Pre-commit hooks] -----> lint + format + type-check (local, instant)
        |
        v
[GitHub Actions CI] ----> test + build + lint + security (cloud, ~3 min)
        |
        v
[Dependabot/Renovate] --> weekly dep update PRs (auto)
        |
        v
[Release automation] ---> version bump + changelog + npm publish (on merge to release branch)
        |
        v
[Pi version watcher] ---> alert when new Pi version drops (weekly check)
```

---

## 1. Pre-commit Hooks (automate locally)

**What:** Run lint + format + type-check before every commit. Catches issues before they reach CI.

**How:** Use `husky` + `lint-staged`

```bash
npm install -D husky lint-staged
npx husky init
```

**Config in package.json:**
```json
{
  "lint-staged": {
    "src/**/*.ts": ["biome check --apply", "biome format --write"],
    "tests/**/*.ts": ["biome check --apply", "biome format --write"]
  }
}
```

**What it catches:**
- Lint errors (before they fail CI)
- Formatting issues
- Import ordering

**What it does NOT do:**
- Run tests (too slow for pre-commit, that's CI's job)
- Type-check (also slow, CI handles it)

**Effort:** 15 min setup, zero maintenance

---

## 2. Dependency Automation (Renovate or Dependabot)

**What:** Auto-create PRs when dependencies have new versions.

**Recommended: Renovate** (more configurable than Dependabot)

**Config:** `.github/renovate.json`
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "schedule": ["every weekend"],
  "labels": ["dependencies"],
  "packageRules": [
    {
      "matchDepTypes": ["dependencies"],
      "rangeStrategy": "pin",
      "automerge": false
    },
    {
      "matchDepTypes": ["devDependencies"],
      "automerge": true,
      "automergeType": "pr"
    },
    {
      "matchPackageNames": ["@mariozechner/pi-coding-agent", "@mariozechner/pi-ai", "@mariozechner/pi-agent-core"],
      "enabled": false
    }
  ]
}
```

**Key decisions:**
- Production deps: create PR, human reviews (could break things)
- Dev deps: auto-merge if CI passes (low risk)
- Pi packages: DISABLED (we pin these manually, upgrade requires re-audit)

**Effort:** 30 min setup, zero maintenance (Renovate runs as GitHub App)

---

## 3. Release Automation

**What:** Automate version bump, changelog generation, npm publish, git tag.

**How:** Use `release-please` (Google's tool, works with conventional commits)

**Flow:**
1. Merge PRs to main with conventional commit messages (`feat:`, `fix:`, `docs:`)
2. release-please creates a "Release PR" that bumps version + generates changelog
3. Merge the Release PR to trigger npm publish

**Config:** `.github/workflows/release.yml`
```yaml
name: Release
on:
  push:
    branches: [main]
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node
          package-name: mypensieve
```

**What it automates:**
- Version bump in package.json
- CHANGELOG.md generation from commit messages
- Git tag creation
- npm publish trigger

**What it does NOT do:**
- Decide WHEN to release (human merges the Release PR)
- Write good commit messages (human responsibility)

**Effort:** 1 hour setup, zero maintenance

---

## 4. Pi Version Watcher

**What:** Weekly check if Pi has released a new version. Alert Sreeni if it has.

**Why:** Pi is our foundation. New versions may have breaking changes, new APIs we should adopt, or security fixes.

**How:** GitHub Actions cron job

```yaml
name: Pi Version Check
on:
  schedule:
    - cron: '0 8 * * 1'  # Every Monday 8am UTC
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          CURRENT=$(node -e "console.log(require('./package.json').dependencies['@mariozechner/pi-coding-agent'])")
          LATEST=$(npm view @mariozechner/pi-coding-agent version 2>/dev/null || echo "unknown")
          if [ "$CURRENT" != "$LATEST" ]; then
            echo "Pi update available: $CURRENT -> $LATEST"
            # Create an issue
            gh issue create --title "Pi update: $CURRENT -> $LATEST" --body "Run pi-reaudit.sh before upgrading"
          fi
```

**Effort:** 30 min setup, zero maintenance

---

## 5. Code Coverage

**What:** Track test coverage over time. Fail CI if coverage drops.

**How:** Vitest has built-in coverage via `@vitest/coverage-v8`

```bash
npm install -D @vitest/coverage-v8
```

**Add to CI:**
```yaml
- name: Test with coverage
  run: npx vitest run --coverage
- name: Check coverage threshold
  run: |
    # Fail if coverage drops below 70%
    npx vitest run --coverage --coverage.thresholds.lines=70
```

**Effort:** 30 min setup, zero maintenance

---

## 6. Enhanced CI Pipeline

**Current CI does:** test + build + lint + security
**Enhanced CI adds:**

| Check | What | When |
|-------|------|------|
| Coverage threshold | Fail if < 70% line coverage | Every push |
| Bundle size check | Alert if dist/ grows > 20% | Every push |
| Commit message lint | Enforce conventional commits | Every PR |
| PR size warning | Flag PRs > 500 lines changed | Every PR |
| Stale PR cleanup | Auto-close PRs inactive > 30 days | Weekly cron |

---

## What Can Be Automated vs Needs Sessions

### Fully Automatable (set up once, runs forever)

| Task | Tool | Frequency |
|------|------|-----------|
| Lint + format | Pre-commit hooks (husky) | Every commit |
| Test + build | GitHub Actions CI | Every push |
| Security scan | Snyk + npm audit | Every push |
| Dev dep updates | Renovate (auto-merge) | Weekly |
| Prod dep update PRs | Renovate (PR only) | Weekly |
| Pi version alerts | GitHub Actions cron | Weekly |
| Coverage tracking | Vitest coverage | Every push |
| Changelog generation | release-please | On merge |
| npm publish | GitHub Actions | On release tag |

### Semi-Automated (tool helps, human decides)

| Task | Tool | Human part |
|------|------|-----------|
| Production dep upgrades | Renovate creates PR | Review + test + merge |
| Release timing | release-please creates Release PR | Decide when to merge |
| Security vuln response | Snyk alerts | Decide fix priority |
| Pi version upgrade | Watcher creates issue | Run re-audit, test, upgrade |

### Manual Sessions Required (human brain needed)

| Task | Why it can't be automated |
|------|--------------------------|
| Feature development | Architecture decisions, design choices |
| Bug investigation | Requires understanding context + root cause |
| Pi re-audit | Breaking changes need manual evaluation |
| Persona/UX testing | Subjective quality judgment |
| Security review (deep) | Adversarial thinking, threat modeling |
| Council persona design | Creative + behavioral tuning |
| v0.2.0/v0.3.0 milestone planning | Strategic decisions |

---

## Implementation Priority

### Phase A - Do Now (30 min total)
1. Pre-commit hooks (husky + lint-staged)
2. Coverage threshold in CI

### Phase B - Do This Week (1 hour total)
3. Renovate for dependency automation
4. Pi version watcher cron

### Phase C - Before v0.2.0 Release (1 hour)
5. release-please for automated releases
6. Conventional commit enforcement
7. CHANGELOG.md generation

### Phase D - Nice to Have
8. Bundle size tracking
9. PR size warnings
10. Stale PR cleanup

---

## Commit Message Convention

For release-please to generate good changelogs, use conventional commits:

```
feat: add Telegram listener with grammy long-polling
fix: resolve empty response extraction on Telegram
docs: add ROADMAP.md with v0.2.0-v2.0.0 backlogs
chore: pin grammy and cron to exact versions
refactor: use before_agent_start instead of context event
test: add 25 filesystem guardrail tests
ci: add build tools for better-sqlite3 native compilation
```

Prefixes: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `perf`, `style`
