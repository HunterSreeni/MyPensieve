# MyPensieve - Known Limitations
> Last updated: 2026-04-21 (v0.3.5)

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

- **Supported providers** (v0.1.18+): Ollama, Anthropic, OpenRouter, OpenAI
- Ollama cloud models require `ollama signin` with an NVIDIA account
- Ollama local models require sufficient VRAM (7B = ~4GB, 13B = ~8GB, 70B = ~40GB)
- Non-Ollama providers require API keys in `~/.mypensieve/.secrets/{provider}.json`
- Wizard supports multi-provider selection (v0.2.0-alpha.1+) with API key validation
- Model quality varies - smaller models may not follow the persona prompt or security rules well

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Linux | Tested | Primary development platform |
| macOS | Untested | Should work (same Unix paths/permissions) |
| Windows | Untested | Paths work (os.homedir), but no chmod enforcement |

- File permissions (chmod 0700/0444) only enforced on Linux/macOS
- Daemon auto-start via `mypensieve daemon install` (Linux/systemd only, macOS launchd planned)
- All scheduled tasks ("echoes") run in-process - no OS cron dependency

## Telegram Channel

- Uses **long-polling** (not webhooks) - simpler but slightly higher base latency
- Bot must be running (`mypensieve start`) to receive messages
- Messages sent while bot is offline queue on Telegram's side and deliver when bot restarts
- No push notifications when bot is offline
- Group messages blocked by default (security - prevents token burn from strangers)
- Available commands: `/start`, `/reset`, `/status`, `/help`

## Network Exposure

- **MyPensieve does NOT open any inbound listener.** No HTTP server, no webhook endpoint, no RPC port. The Telegram bot uses long-polling (outbound), providers are outbound HTTPS clients, and MCP servers run as stdio subprocesses. Nothing on the machine accepts network connections on MyPensieve's behalf.
- **Do not point `OLLAMA_HOST` at `0.0.0.0` on a multi-user or LAN-reachable machine.** The default `http://127.0.0.1:11434` keeps Ollama on loopback. Binding Ollama to `0.0.0.0` exposes the local model server to every host on the network without auth - not a MyPensieve bug, but a foot-gun because MyPensieve will talk to whatever host you configure.
- **systemd unit runs as the invoking user**, not root. `mypensieve daemon install` writes to `~/.config/systemd/user/`, no sudo required. Hardening in the unit: `NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths=~/.mypensieve`, `ReadOnlyPaths=~/`, `PrivateTmp`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6` (v0.3.5+), `LockPersonality`, `RestrictRealtime`, `RestrictSUIDSGID`.

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
- The daily-log and backup echoes are registered but **not yet wired** to actual skills (planned v0.3.0)
- The memory extractor is wired (`mypensieve extract` + `mypensieve extractor install` systemd timer), but only the `ollama` provider is supported as the extraction model. OpenRouter / Anthropic / OpenAI extraction support is planned for v0.2.0
- Extracted records are tagged `source: "auto"` with `confidence: 0.65`. Manual `/decide` records keep their higher `0.95` confidence
- The extractor holds a pidfile lock at `<projectsDir>/.extractor.lock`; concurrent runs return immediately rather than queueing. If the process is hard-killed the lock is reclaimed on the next run when the recorded pid is no longer alive
- Session JSONL files above 50 MB are skipped - the extractor silently ignores them to avoid OOM. If you have a legitimately huge session, split it or raise `MAX_SESSION_JSONL_BYTES`
- Dispatch-level `confirm: true` is accepted by the schema but not yet enforced at the dispatcher (planned v0.3.0)
- Agent can report on echoes but cannot yet trigger them manually

## Deprecated Transitive Dependencies (cosmetic warnings on install)

- `prebuild-install@7.1.3` - from `better-sqlite3`. Still works, just unmaintained. Resolves when `better-sqlite3` drops it.
- `node-domexception@1.0.0` - from Pi's `node-fetch`. Node 20+ has native DOMException. Resolves when Pi updates `node-fetch`.

These are warnings, not errors. They don't affect functionality or security.

## Known Bugs / Rough Edges

- Agent may occasionally show raw tool output instead of a natural response (fallback when model skips text commentary)
- The `save_persona` tool may not fire correctly if the model doesn't follow tool-use patterns
- System prompt security rules depend on model quality - smaller models may not follow them consistently
- Wizard TUI uses @clack/prompts (v0.2.0-alpha.1+) with select, confirm, spinner, and text prompts
