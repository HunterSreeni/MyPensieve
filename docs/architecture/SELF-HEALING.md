# MyPensieve - Self-Healing Overview
> Status: PLANNED (v0.2.0) | Created: 2026-04-12

---

## What Self-Healing Is

The agent detects operational problems in its own infrastructure and fixes them automatically - or surfaces a clear diagnosis to the operator when it can't.

## Scope Boundary

### CAN touch (data + config)
- `~/.mypensieve/config.json` - fix misconfigurations
- `~/.mypensieve/state/` - reset corrupted state
- `~/.mypensieve/logs/` - rotate, clean
- `~/.mypensieve/.secrets/` - detect missing, prompt operator
- `~/.pi/agent/extensions/mypensieve/index.js` - reinstall bridge
- SQLite index - rebuild from JSONL (drop-and-reindex pattern)
- Echoes - restart failed scheduled tasks

### NEVER touches (code)
- `src/`, `dist/`, `node_modules/`, `package.json`
- Any system files (`/etc/`, `~/.bashrc`, etc.)
- Any code outside `~/.mypensieve/`

**Principle:** Self-healing operates on DATA and CONFIGURATION, never on CODE. Broken code = bug = new version release by a human.

## How It Works

1. **Detection** - agent reads its own error log (`~/.mypensieve/logs/errors/`) and tool log (`~/.mypensieve/logs/tools/`)
2. **Diagnosis** - matches error patterns to known fixes (e.g. "config_read failed" = config.json corrupted)
3. **Action** - applies the fix automatically if safe, or surfaces the diagnosis to the operator
4. **Verification** - re-checks after fix to confirm resolution

## Common Recovery Patterns

| Error | Auto-fix | Action |
|-------|----------|--------|
| Config read failed | Yes | Rebuild from last known good (git history) |
| SQLite index corrupt | Yes | Drop and rebuild from JSONL source |
| Extension bridge missing | Yes | Re-run `installMyPensieveExtension()` |
| Ollama unreachable | No | Surface error, suggest `ollama serve` |
| Telegram token expired | No | Surface error, prompt operator to refresh |
| Secrets file missing | No | Surface error, guide operator through re-creation |
| Echo failed repeatedly | Yes | Disable echo, log reason, notify operator |

## CLI Interface

```
mypensieve recover              # Run all auto-fixes
mypensieve recover --dry-run    # Show what would be fixed without doing it
mypensieve doctor               # Healthcheck (detect issues without fixing)
mypensieve errors               # Show recent error log
```

## Trigger Points

- **On startup** (`mypensieve start`) - quick healthcheck before booting echoes/Telegram
- **On error** - certain errors trigger immediate recovery attempt
- **On demand** - operator runs `mypensieve recover`
- **Nightly** - extractor echo checks system health as part of its run
