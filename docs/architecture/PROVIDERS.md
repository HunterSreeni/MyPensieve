# MyPensieve - Provider Routing
> Status: LOCKED | Created: 2026-04-08 | Revised after Pi research
> **Read PI-FOUNDATION.md first.**
> Companion to MEMORY-ARCHITECTURE.md, TOOLSHED-BRIDGE-ARCHITECTURE.md, MULTI-AGENT-RUNTIME.md.
> This doc covers HOW MyPensieve routes capability needs to actual provider/model combinations.

---

## TL;DR - THE PROVIDER ABSTRACTION IS PI'S, NOT OURS

After investigating Pi (see PI-FOUNDATION.md), the entire provider abstraction layer is **already implemented by `@mariozechner/pi-ai`**. Pi ships with 10+ provider adapters built in:

- Anthropic (with **OAuth via Claude Max plan** - the exact flow MyPensieve wanted)
- OpenAI
- Google Gemini + gemini-cli
- Google Vertex
- Azure OpenAI Responses
- Amazon Bedrock
- Mistral
- GitHub Copilot
- OpenAI Codex Responses
- faux (test provider)

**MyPensieve does NOT write provider adapters.** We use `pi-ai` directly. This document used to specify our own `Provider` interface and adapter contracts - all of that is **absorbed into Pi**.

What MyPensieve still owns is **the tier_hint routing layer**: a thin function that maps the four capability classes (`deep | standard | light | minimal`) to specific provider/model combinations the user has configured. That is what this doc now covers.

This is the **N4 (locked, revised)** architecture decision.

---

## THE DECOUPLING PRINCIPLE (UNCHANGED)

**Nothing in MyPensieve is bound to a specific AI provider or model.** Skills, agents, and the OS itself describe **what capability they need**, not **which model to use**. The user supplies their own credentials (via Pi's auth system), picks which providers to enable, and decides how to map capability needs to actual models.

This means MyPensieve survives:

- A vendor raising prices (route everything to a different vendor)
- A new free model on OpenRouter (add it, re-route)
- A user with no internet (route everything to local Ollama)
- A user who only trusts cloud (no Ollama)
- Future providers that don't exist yet - **and Pi gets them automatically**

---

## THE MENTAL MODEL

```
┌──────────────────────────────────────────────────────────────┐
│  Skill or Agent declares capability need                     │
│      tier_hint: "standard"                                   │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Bridge resolves at invocation time                          │
│      1. Check overrides (highest priority)                   │
│      2. Look up routing[tier_hint]                           │
│      3. Resolve provider/model string                        │
│      4. Find provider in registry                            │
│      5. Call provider.complete(model, ...)                   │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Provider adapter handles the API call                       │
│      AnthropicProvider | OllamaProvider | OpenRouterProvider │
└──────────────────────────────────────────────────────────────┘
```

The skill knows nothing about Anthropic. The bridge knows nothing about HTTP endpoints. The provider knows nothing about skills. Each layer has one job.

---

## TIER HINTS - THE FOUR CAPABILITY CLASSES

Skills and agents declare a `tier_hint` from this fixed set of four:

| Tier hint | Meaning | Typical use |
|---|---|---|
| `deep` | Highest-capability reasoning available | Code review, weekly synthesis, council orchestration, dark-turn detection, prompt evolution approval |
| `standard` | Balanced everyday model with good reasoning | Code writing, content drafting, research, most interactive work, council POV agents |
| `light` | Fast and cheap model for moderate tasks | Simple summarization, format conversion, classification, structured data extraction |
| `minimal` | Cheapest available - parsing, monitoring, polling | Cron monitoring skills, status checks, catalog returns, format normalization |

**Why exactly four?** Three is too coarse (no room for "fast but capable"). Five+ becomes meaningless (operators stop knowing the difference). Four hits the sweet spot for the cost/capability gradient most users actually navigate.

**Custom tier_hints** are intentionally not supported in MVP. Users can map all four tiers to whatever they want, but cannot define new tier names. This keeps skill manifests portable across installs - any MyPensieve install can run any MyPensieve skill regardless of which provider configuration the user has.

---

## SPLIT OF CONCERNS - PI vs MYPENSIEVE

| Concern | Owner | Where it lives |
|---|---|---|
| Provider auth (OAuth, API key) | **Pi** | `~/.pi/agent/auth.json` (mode 0600), managed by Pi's `AuthStorage` |
| Provider adapters (HTTP, streaming, tool format translation) | **Pi** | `pi-ai/providers/*` |
| Model discovery (`listModels()`) | **Pi** | Provider-specific, exposed via `pi-ai` |
| Provider healthcheck | **Pi** | Provider-specific |
| **Tier_hint routing** (`deep`/`standard`/`light`/`minimal` → provider/model) | **MyPensieve** | `~/.mypensieve/config.json` `routing` section |
| **Per-skill / per-agent overrides** | **MyPensieve** | `~/.mypensieve/config.json` `overrides` section |
| **Embedding routing** | **MyPensieve** | `~/.mypensieve/config.json` `embedding` section |

**Auth lives in `~/.pi/agent/auth.json`** - managed by Pi. We do not duplicate it. When MyPensieve needs to call a provider, it uses `pi-ai` which reads from Pi's `AuthStorage`. Our `~/.mypensieve/.secrets/` is **only** for non-AI secrets (Telegram bot token, GitHub PAT for our own use, etc.).

---

## CONFIG STRUCTURE (MyPensieve's part only)

The provider configuration in `~/.mypensieve/config.json` is now much smaller - we only specify our routing preferences, not provider details.

```json
{
  "tier_hints_available": ["deep", "standard", "light", "minimal"],

  "routing": {
    "deep":     "anthropic/claude-opus-4-6",
    "standard": "anthropic/claude-sonnet-4-6",
    "light":    "openrouter/google/gemini-2.5-flash",
    "minimal":  "openrouter/nvidia/nemotron-3-super"
  },

  "overrides": {
    "skill:weekly-review": "anthropic/claude-opus-4-6",
    "skill:deliberate":    "anthropic/claude-opus-4-6",
    "agent:critic":        "ollama/qwen2.5:72b"
  },

  "embedding": {
    "enabled": true,
    "provider": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 768
  }
}
```

### Section: `routing`

Maps each tier_hint to a `provider/model` string. The provider name must be a provider Pi knows about (registered via `pi-ai`). The model name must be a model that provider supports.

The MyPensieve routing function:

```typescript
function resolveTierHint(tier_hint: string, target_type?: string, target_name?: string): {provider: string, model: string} {
  // 1. Override (highest priority)
  if (target_type && target_name) {
    const override_key = `${target_type}:${target_name}`;
    if (config.overrides?.[override_key]) {
      return parse(config.overrides[override_key]);
    }
  }
  
  // 2. Routing table
  if (config.routing?.[tier_hint]) {
    return parse(config.routing[tier_hint]);
  }
  
  // 3. Fallback (with warning)
  log.warn(`No routing for tier_hint '${tier_hint}', using first available pi-ai provider`);
  return firstAvailablePiProvider();
}

function parse(provider_model_string: string): {provider: string, model: string} {
  const [provider, ...modelParts] = provider_model_string.split("/");
  return {provider, model: modelParts.join("/")};
}
```

This is **the entire routing layer** - one function, ~20 lines. Everything else is Pi's job.

### Section: `overrides`

Per-skill or per-agent pinning. Highest priority. Use sparingly - the routing table should handle 95% of cases. Override keys are `skill:<name>` or `agent:<name>`.

### Section: `embedding`

Embeddings are not tier-routed (see MEMORY-ARCHITECTURE.md for the reasoning). They reference a provider/model directly. Setting `enabled: false` disables L4 semantic search cleanly.

**Note:** Pi does not have native embedding support in `pi-ai` for all providers (Anthropic does not offer embeddings; OpenAI does; Ollama does; etc.). MyPensieve calls embeddings via the appropriate provider directly when supported, or via a provider that has embedding capabilities.

---

## PROVIDERS AVAILABLE THROUGH PI (VERIFIED 2026-04-08)

Pi ships with these provider adapters in `/packages/ai/src/providers/`. **MyPensieve does not write any of these adapters.** All are configurable via Pi's `~/.pi/agent/auth.json` (for credentials) and `~/.pi/agent/models.json` (for model definitions).

| Provider file | Provider | Auth | Notes |
|---|---|---|---|
| `anthropic.ts` | **Anthropic** | OAuth (Claude Max plan, $0 marginal) or API key | Native, first-class. The OAuth flow is the same one Claude Code uses. |
| `openai-completions.ts` | **OpenAI Completions API + any OpenAI-compatible endpoint** | API key | This is the most important file for MyPensieve. It handles OpenAI itself AND every OpenAI-compatible service via custom `baseUrl`. |
| `openai-responses.ts` | OpenAI Responses API (newer) | API key | |
| `openai-codex-responses.ts` | OpenAI Codex Responses API | API key | |
| `google.ts` | Google Gemini direct | API key | |
| `google-vertex.ts` | Google Vertex AI | OAuth / service account | |
| `google-gemini-cli.ts` | Google gemini-cli variant | gemini-cli auth | |
| `azure-openai-responses.ts` | Azure OpenAI | API key | |
| `amazon-bedrock.ts` | Amazon Bedrock | AWS credentials | |
| `mistral.ts` | Mistral AI | API key | |
| `github-copilot-headers.ts` | GitHub Copilot | OAuth | |
| `faux.ts` | Test provider | None | For development |

**No `openrouter.ts` or `ollama.ts` files exist.** That is not a gap - both work via the `openai-completions` shim with custom `baseUrl` configuration. See the next section.

### OpenRouter is a `KnownProvider` in pi-ai

OpenRouter is first-class in every way **except** having its own dedicated provider file:

- Listed in `KnownProvider` type at `packages/ai/src/types.ts:33`
- Env var `OPENROUTER_API_KEY` recognized in `packages/ai/src/env-api-keys.ts:119`
- Generated model catalog: `packages/ai/scripts/generate-models.ts` fetches `https://openrouter.ai/api/v1/models`
- Dedicated `thinkingFormat: "openrouter"` for handling reasoning tokens
- Dedicated `openRouterRouting` compat field
- Anthropic-cache pass-through handling for OpenRouter
- Documented config examples at `packages/coding-agent/docs/models.md:221, 291`

To use OpenRouter, just add this to `~/.pi/agent/models.json` (no extension code, no MyPensieve code):

```json
{
  "providers": {
    "openrouter": {
      "type": "openai-completions",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKeyEnv": "OPENROUTER_API_KEY"
    }
  },
  "models": {
    "openrouter:google/gemini-2.5-flash": { "provider": "openrouter", "model": "google/gemini-2.5-flash" },
    "openrouter:nvidia/nemotron-3-super": { "provider": "openrouter", "model": "nvidia/nemotron-3-super" }
  }
}
```

**MVP-usable out of the box. Zero extension code required.**

### Local Ollama works via the same shim

Same pattern - no dedicated provider file; accessed via `openai-completions` with `baseUrl: http://localhost:11434/v1`. Pi's overflow detection explicitly handles Ollama error strings (`packages/ai/src/utils/overflow.ts:44`). Documented at `packages/coding-agent/docs/models.md:18-88` with the right compat flags (`supportsDeveloperRole: false`, `supportsReasoningEffort: false`).

`models.json` config:

```json
{
  "providers": {
    "ollama": {
      "type": "openai-completions",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama"
    }
  },
  "models": {
    "ollama:llama3.1:70b": { "provider": "ollama", "model": "llama3.1:70b", "supportsDeveloperRole": false }
  }
}
```

**MVP-usable out of the box. Zero extension code required.**

### Other OpenAI-compatible hosts (also config-only)

Same pattern works for:

| Provider | Endpoint | Env var |
|---|---|---|
| **Groq** | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| **Together** | `https://api.together.xyz/v1` | `TOGETHER_API_KEY` |
| **Fireworks** | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| **DeepInfra** | `https://api.deepinfra.com/v1/openai` | `DEEPINFRA_API_TOKEN` |
| **Custom OpenAI-compat** | (any) | (any) |

**All work via models.json with no extension code.**

### Ollama Cloud (verified 2026-04-09)

**Hosted Ollama (Ollama Cloud at `https://ollama.com`) works via the openai-completions shim. Zero extension code needed.** Same pattern as OpenRouter, Groq, Together.

**Verified facts:**

- **OpenAI-compat base URL:** `https://ollama.com/v1` (live, not deprecated)
- **Auth:** `Authorization: Bearer ${OLLAMA_API_KEY}`
- **Endpoints confirmed live:** `/v1/models` (200, returns OpenAI-shaped `{"object":"list","data":[...]}`), `/v1/chat/completions` (401 on bad key = route exists). Native `/api/chat` also still works.
- **Model discovery:** `/v1/models` returns the curated cloud catalog. Cannot pull arbitrary models in cloud mode - the catalog is what Ollama hosts (gpt-oss, qwen3-coder, kimi-k2, glm, deepseek-v3, gemma3/4, mistral-large-3, etc.). Use exact IDs from `/v1/models`.

**Verification commands (re-runnable):**

```bash
curl -sS https://ollama.com/v1/models -H "Authorization: Bearer $OLLAMA_API_KEY"
curl -sS https://ollama.com/v1/chat/completions \
  -H "Authorization: Bearer $OLLAMA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-oss:20b", "messages": [{"role": "user", "content": "hi"}]}'
```

**Why this was previously listed as unknown:** the official `docs.ollama.com/cloud` page only documents the native `/api/chat` style and omits any mention of `/v1`. The `docs.ollama.com/api/openai-compatibility` page documents `/v1/*` but frames every example around `localhost:11434`, implying local-only. Neither page cross-links the other. The Ollama Cloud public-beta launch (Jan 15, 2026) is the source of truth that confirms cloud parity - and the live endpoint confirms it.

**MyPensieve MVP config:** Cloud Ollama ships supported via `~/.pi/agent/models.json` with no extension code:

```json
{
  "ollama-cloud": {
    "type": "openai-completions",
    "baseUrl": "https://ollama.com/v1",
    "apiKeyEnv": "OLLAMA_API_KEY"
  }
}
```

Document the curated-catalog constraint in the wizard so operators know cloud model IDs come from `/v1/models`, not from the local installable set.

---

## THE INSTALL WIZARD: PROVIDER SETUP

Provider configuration is a multi-step phase in `mypensieve init`. **The MyPensieve wizard writes to Pi's `~/.pi/agent/auth.json` and `~/.pi/agent/models.json`, plus its own `~/.mypensieve/config.json` routing section.** No external `pi auth login` flow is required - both Pi and MyPensieve installs are managed by the same wizard.

```
[Step 5 of 9] Configure AI providers

MyPensieve runs on top of Pi (@mariozechner/pi-coding-agent).
You configure providers ONCE here, and MyPensieve uses them via tier_hint routing.

Recommended providers for MVP:
  [1] Anthropic (Claude)  - OAuth (Claude Max plan, $0 marginal) or API key
  [2] OpenRouter          - API key (aggregator with hundreds of models including free tiers)
  [3] Local Ollama        - No auth needed (requires Ollama installed locally)

Other supported providers (configurable later):
  - OpenAI direct, Google Gemini, Google Vertex, Azure OpenAI, Amazon Bedrock,
    Mistral, GitHub Copilot, Groq, Together, Fireworks, custom OpenAI-compat

You must configure at least one. We recommend (1) Anthropic for best quality
and either (2) OpenRouter or (3) Ollama for cheap fallback.

> Select providers to configure (e.g. "1,2" or "all-recommended"): 1,2
```

For each selection:

```
=== Configuring Anthropic ===

[1] Authentication method:
    [a] OAuth via Claude Max plan (recommended, $0 marginal cost)
    [b] API key (pay per use)
    > Choose: a

[2] Opening browser for Anthropic OAuth flow...
[3] Waiting for callback... ✓
[4] Storing token at ~/.pi/agent/auth.json (mode 0600) ✓
[5] Test call to claude-haiku-4-5... ✓ (412ms)
[6] Discovering available models... ✓ (opus-4.6, sonnet-4.6, haiku-4.5)
[7] Writing model definitions to ~/.pi/agent/models.json ✓

Provider 'anthropic' configured.

=== Configuring OpenRouter ===

[1] Visit https://openrouter.ai/keys to get an API key
    Paste your key (input hidden): ********
[2] Storing key at ~/.pi/agent/auth.json ✓
[3] Test call to a free-tier model... ✓
[4] Discovering available models from OpenRouter API... ✓ (147 models)
[5] Writing models.json entries with `type: openai-completions`,
    `baseUrl: https://openrouter.ai/api/v1`, `thinkingFormat: openrouter` ✓

Provider 'openrouter' configured (via openai-completions shim).
```

After all providers are configured, MyPensieve writes ITS routing config to `~/.mypensieve/config.json`:

```
[Step 6 of 9] Tier_hint routing

You configured: anthropic, openrouter

Suggested MyPensieve routing:
  deep      → anthropic/claude-opus-4-6           (best reasoning)
  standard  → anthropic/claude-sonnet-4-6         (balanced everyday)
  light     → openrouter/google/gemini-2.5-flash  (cheap, fast)
  minimal   → openrouter/nvidia/nemotron-3-super  (cheapest)

Press enter to accept, or 'customize' to override:
```

This gets written to `~/.mypensieve/config.json` `routing` section.

The same educate-choose-verify pattern applies to embedding setup (Step 7), which is a separate phase because embeddings are not tier-routed.

---

## ADDING A PROVIDER POST-INSTALL

Two steps:

1. **Add to Pi:** `pi auth login <provider>` - runs Pi's auth flow, stores credentials in `~/.pi/agent/auth.json`
2. **Update MyPensieve routing (optional):** `mypensieve config edit` - if you want to route any tier_hint to the new provider

If step 2 is skipped, the new provider is available to skills/agents that explicitly reference it via `overrides`, but the tier_hint routing table still points elsewhere.

---

## REMOVING A PROVIDER

Symmetric:

1. **Update MyPensieve routing first** (so nothing references the about-to-be-removed provider): `mypensieve config edit`
2. **Remove from Pi:** `pi auth logout <provider>` - removes credentials from Pi's `auth.json`

The MyPensieve wizard also offers a one-shot `mypensieve provider remove <name>` that does both steps and verifies no routing references remain.

---

## COST TRACKING PER PROVIDER

Every bridge call captures `provider`, `model`, `tokens_in`, `tokens_out`, and `runtime_ms` in the audit log. A nightly cron job rolls up costs:

```
~/.mypensieve/logs/cost/
├── 2026-04-08.json
├── 2026-04-09.json
└── monthly/
    └── 2026-04.json
```

Each daily file:

```json
{
  "date": "2026-04-08",
  "totals": {
    "tokens_in": 124581,
    "tokens_out": 89342,
    "calls": 142,
    "estimated_cost_usd": 0.84
  },
  "by_provider": {
    "claude": { "tokens_in": 89234, "tokens_out": 71203, "calls": 89, "estimated_cost_usd": 0.81 },
    "openrouter": { "tokens_in": 35347, "tokens_out": 18139, "calls": 53, "estimated_cost_usd": 0.03 }
  },
  "by_tier_hint": {
    "deep":     { "calls": 12, "estimated_cost_usd": 0.42 },
    "standard": { "calls": 77, "estimated_cost_usd": 0.39 },
    "light":    { "calls": 32, "estimated_cost_usd": 0.02 },
    "minimal":  { "calls": 21, "estimated_cost_usd": 0.01 }
  }
}
```

This data feeds:

- The morning briefing skill (operator sees yesterday's cost)
- Budget cap enforcement (hard cut at configured monthly cap)
- Routing optimization (Loop B in v1.5+: "you spent $0.81 on Anthropic this week - maybe re-route `light` to a free model")
- Decision support: when the operator is choosing between providers, real cost data informs the choice

---

## RELATIONSHIP TO LOCKED DECISIONS

| Locked decision | How providers interact |
|---|---|
| **N1 (embeddings)** | Embeddings are a separate config field, not tier_hint routed. They reference a provider/model directly via `embedding.provider` and `embedding.model`. |
| **N2 (toolshed + bridge)** | Skills and agents use `tier_hint` instead of hardcoded models. Bridge resolves tier_hint via the routing table at invocation time. |
| **N3 (config layout)** | `config.json` gains `providers`, `routing`, `overrides`, and `embedding` sections. Same read-only-at-runtime rule applies. |
| **Memory architecture** | Memory operations don't care about providers - they call the bridge with a tier_hint and let the bridge route. |
| **Channel binding** | Channel binding can restrict which providers a channel is allowed to route to (e.g. a Telegram channel might be denied access to expensive `deep` tier). |

---

## EXTENSIBILITY

Adding a new provider is **Pi's job, not ours**. When `pi-ai` adds support for a new provider (or when a user installs a `custom-provider-*` extension), MyPensieve picks it up automatically because:

- Pi's `AuthStorage` handles credentials
- Pi's `pi-ai` library exposes a unified `complete()` interface
- MyPensieve only needs to know the provider/model string format (`provider/model`), which works for any provider Pi knows about

To use a newly added provider in MyPensieve:

1. Configure it in Pi (`pi auth login <new-provider>` or via the custom-provider extension)
2. Update MyPensieve routing in `~/.mypensieve/config.json` to reference it
3. Done

The four tier_hints stay fixed. Only the routing changes when new providers become available.

If a user wants a provider Pi does not yet support, they can write a Pi extension following the `examples/extensions/custom-provider-*` pattern. Once installed, MyPensieve sees it just like a built-in.

---

## SUMMARY OF LOCKED CHOICES

| Aspect | Choice |
|---|---|
| Decoupling principle | Skills, agents, and OS describe capability needs, not specific models |
| Tier hints | Fixed set of four: `deep | standard | light | minimal` |
| Custom tier_hints | Not supported - keeps manifests portable across installs |
| Routing | User-configured map from tier_hint → `provider/model` string |
| Overrides | Per-skill or per-agent pinning, highest priority |
| Embeddings | Separate config field (not tier-routed), L4 optional if disabled |
| **Provider adapters** | **Pi's responsibility (`pi-ai`). MyPensieve does not write any.** |
| **Auth storage** | **Pi's responsibility (`~/.pi/agent/auth.json`). MyPensieve does not duplicate.** |
| **Resolution algorithm** | **MyPensieve's `resolveTierHint()` function: overrides → routing → fallback** |
| MVP providers (recommended) | Anthropic (OAuth via Claude Max), OpenRouter (API key), Ollama (local) - all configured via Pi |
| Install requirement | At least one provider must be configured (in Pi) |
| Wizard pattern | MyPensieve wizard delegates to Pi for auth, then writes its own routing config |
| Cost tracking | MyPensieve extension subscribes to Pi's `BeforeProviderRequestEvent` + `TurnEndEvent` |
| Adding providers post-install | `pi auth login <provider>` then `mypensieve config edit` |

---

## HARD UNSOLVED PROBLEMS (NOT BLOCKING MVP)

Most of these are now Pi's problems, not ours. Listed here for awareness.

1. **OAuth refresh** - Anthropic OAuth tokens expire. **Pi handles this** via its `AuthStorage` refresh mechanism. Verify Pi actually refreshes tokens automatically before relying on it; if not, MyPensieve should add a nightly cron extension that triggers Pi's refresh.

2. **Rate limiting** - Each provider has its own rate limits. **Pi may or may not handle this** at the provider adapter level. MyPensieve's cost tracking extension should at least log rate-limit headers to detect issues.

3. **Failover order** - If the routed provider is down, what is the fallback chain? **Suggested MyPensieve addition (v1.5+):** a `fallback_chain` per tier_hint in config that lists alternative provider/model strings to try in order. The `resolveTierHint()` function would loop through them on healthcheck failure.

4. **Multi-region / latency-aware routing** - For users far from US-east, latency matters. v2+ concern.

5. **Provider parity for tool-use** - Different providers support different tool/function-calling formats. **Pi handles this** in its provider adapters - they translate between Anthropic's format, OpenAI's format, etc. This is one of the biggest reasons to use Pi instead of writing our own.

6. ~~**Verify Ollama Cloud API contract**~~ - **Resolved 2026-04-09.** `https://ollama.com/v1` is live, OpenAI-compat, works via `openai-completions` shim with zero extension code. See "Ollama Cloud (verified 2026-04-09)" section above.

---

*Implementation note: when MyPensieve gets built, this doc is the contract. Any deviation must be a new locked decision documented here, not silent drift.*
