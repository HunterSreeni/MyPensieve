# MyPensieve - Known Limitations
> Last updated: 2026-04-13 (v0.1.11)

These are honest disclaimers about what works, what doesn't, and what to expect.

---

## Response Latency

- **Ollama Cloud models** (nemotron-3-super:cloud, etc.) route through Ollama's proxy to NVIDIA servers
- Typical response time: **90-120 seconds per message** via Telegram
- This is model/network latency, NOT a MyPensieve bug
- Local models (if you have the VRAM) are significantly faster (~5-15s)
- Telegram shows continuous "typing..." indicator while the agent thinks
- CLI mode has the same latency but Pi's TUI shows streaming tokens

## Model Dependency

- Currently **only Ollama provider** is wired (v0.1.x)
- Cloud models require `ollama signin` with an NVIDIA account
- Local models require sufficient VRAM (7B = ~4GB, 13B = ~8GB, 70B = ~40GB)
- No OpenRouter/Anthropic/OpenAI support yet (planned for v0.3.0)
- Model quality varies - smaller models may not follow the persona prompt or security rules well

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Linux | Tested | Primary development platform |
| macOS | Untested | Should work (same Unix paths/permissions) |
| Windows | Untested | Paths work (os.homedir), but no chmod enforcement |

- File permissions (chmod 0700/0444) only enforced on Linux/macOS
- Daemon auto-start (systemd/launchd) not yet implemented (v0.2.0)
- All scheduled tasks ("echoes") run in-process - no OS cron dependency

## Telegram Channel

- Uses **long-polling** (not webhooks) - simpler but slightly higher base latency
- Bot must be running (`mypensieve start`) to receive messages
- Messages sent while bot is offline queue on Telegram's side and deliver when bot restarts
- No push notifications when bot is offline
- Group messages blocked by default (security - prevents token burn from strangers)
- Available commands: `/start`, `/reset`, `/status`, `/help`

## Security Guardrails (hardened in v0.1.6-v0.1.10)

- **Symlink traversal**: Fixed in v0.1.6 - uses `fs.realpathSync()` to resolve symlinks before deny/allow checks
- **Bash deny patterns**: Regex-based with 30+ patterns. Covers sudo, rm -rf, find -delete, dd, eval, interpreter escapes, download-then-execute. Sophisticated evasion is still theoretically possible
- **Read deny-list**: Blocks /etc/shadow, ~/.ssh/, ~/.config/, /proc/, /sys/, .env files, .pem/.key files
- **Write allow-list**: Only ~/.mypensieve/, cwd, /tmp/ (symlink-safe)
- **Output sanitizer**: Redacts bot tokens, API keys, Bearer tokens, URL credentials, allowed_peers, and secrets paths before Telegram replies
- **System prompt security rules**: 8 mandatory rules covering secrets access, prompt leakage, credential handling, config privacy. LLM-enforced (not deterministic) - model quality affects compliance
- **Defense in depth**: guardrails (code) + tool guard (hook) + output sanitizer (filter) + system prompt rules (LLM)

## Echoes (Scheduled Tasks)

- Echoes only run while `mypensieve start` is running
- If the process stops, no scheduled tasks fire until restarted
- The daily-log, extractor, and backup echoes are registered but **not yet wired** to actual skills (v0.2.0)
- Agent can report on echoes but cannot yet trigger them manually

## Deprecated Transitive Dependencies (cosmetic warnings on install)

- `prebuild-install@7.1.3` - from `better-sqlite3`. Still works, just unmaintained. Resolves when `better-sqlite3` drops it.
- `node-domexception@1.0.0` - from Pi's `node-fetch`. Node 20+ has native DOMException. Resolves when Pi updates `node-fetch`.

These are warnings, not errors. They don't affect functionality or security.

## Known Bugs / Rough Edges

- Agent may occasionally show raw tool output instead of a natural response (fallback when model skips text commentary)
- The `save_persona` tool may not fire correctly if the model doesn't follow tool-use patterns
- System prompt security rules depend on model quality - smaller models may not follow them consistently
- Wizard TUI is basic readline (no arrow-key navigation) - upgrade planned for v0.4.0
