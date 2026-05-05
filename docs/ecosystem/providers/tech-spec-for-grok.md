# Switchmaxxer Grok (xAI) Provider Tech Spec

This document captures how xAI's Grok API fits into Switchmaxxer as an upstream service provider, the endpoint surface Switchmaxxer talks to, the dialect constraints that determine which API mode is used, and the cost numbers used to populate model metadata.

Documentation placement note:

- this document lives under `docs/ecosystem/providers/` because Grok / xAI is an external upstream, not a Switchmaxxer-owned subsystem
- it should not be moved into `docs/swe/` or `docs/subsystems/`; those trees are for Switchmaxxer-internal engineering and component specs
- the organizing principle is domain ownership first: this file is a boundary document describing how Switchmaxxer integrates with a third-party API surface

## Background: Grok in xAI's Ecosystem

Grok is the LLM family produced by **xAI**, the AI lab founded in 2023 and associated with the X (formerly Twitter) platform. xAI exposes Grok through several surfaces with different audiences:

- **xAI API on `api.x.ai`** — the developer-facing surface, documented at https://docs.x.ai/. Authenticated with an API key minted in the xAI Console at https://console.x.ai/. This is the surface Switchmaxxer integrates with.
- **Grok inside the X app and grok.com** — the consumer chat product, not an API. Not relevant here.
- **Cloud reseller surfaces** — Grok is also exposed through some hyperscaler marketplaces (e.g. AWS, Azure, Oracle Cloud). Each of those is a separate billing path with its own auth model. Out of scope for this integration.

xAI's API was deliberately designed to be **OpenAI-compatible** at the wire-format level: the request and response shapes for chat completions are the same as OpenAI's Chat Completions API, so existing OpenAI client libraries can talk to xAI by changing only the base URL and the API key. xAI also exposes an Anthropic-compatible surface for clients written against the Messages API.

The current Grok family centers on the **Grok 4** generation, with size/latency tiers including `grok-4` (flagship reasoning), `grok-4-fast` (lower-latency variant), and `grok-code-fast-1` (a code-tuned variant positioned for high-throughput coding workloads). Grok models support tool use, structured output, vision input on some variants, and an explicit reasoning mode whose tokens are billed as part of output.

## Endpoint Information

Switchmaxxer talks to Grok through xAI's OpenAI-compatible chat completions endpoint:

- **Base URL:** `https://api.x.ai/v1/`
- **Chat completions endpoint:** `https://api.x.ai/v1/chat/completions`
- **Auth:** API key in the `Authorization: Bearer <key>` header

xAI also exposes:

- a parallel `https://api.x.ai/v1/messages` endpoint that speaks Anthropic Messages dialect (with the standard `anthropic-version: 2023-06-01` header), if you prefer to reach Grok through the `anthropic-messages` `api_mode`
- a `https://api.x.ai/v1/models` listing endpoint that mirrors OpenAI's

A trivial liveness check that exercises auth and lists models without spending tokens:

```bash
curl -s https://api.x.ai/v1/models \
  -H "Authorization: Bearer $SWITCHMAXXER_GROK_API_KEY" | head
```

A 200 response listing models confirms the key is valid. A 401 means the key is wrong, missing, or revoked.

## API Mode Selection: Why `openai-completions`

xAI exposes an OpenAI-compatible surface at `/v1/chat/completions`, so `openai-completions` works and is the natural fit. Switchmaxxer only supports `openai-completions` and `anthropic-messages` ([src/platform/types.ts:3](../../../src/platform/types.ts#L3)) — and xAI happens to expose both, so either mode is technically reachable. `openai-completions` is the recommended choice because:

- it is the dialect xAI's documentation treats as primary
- the OpenAI Chat Completions wire format is what Grok's tool-use, structured-output, and reasoning-mode features are documented against
- it lines up with how the rest of the Switchmaxxer provider catalog already targets OpenAI-compat upstreams (OpenAI direct, OpenRouter OpenAI-dialect, Gemini's OpenAI-compat surface)

Practical implications:

- inbound OpenAI-dialect requests pass straight through as the upstream wire format, including tool-call and reasoning-mode parameters
- inbound Anthropic-dialect requests are translated to the OpenAI shape before being forwarded to xAI
- response and streaming SSE format upstream is OpenAI's, and gets translated back if the inbound dialect was Anthropic
- if you specifically want to reach Grok via the Anthropic-compat surface (e.g. to keep an Anthropic-shaped client unchanged), register a second provider named `grok_anthropic` with `--api-mode anthropic-messages` and `--endpoint https://api.x.ai/v1/messages`, exactly the same shape as the OpenRouter dual-provider setup documented in [tech-spec-for-openrouter.md](tech-spec-for-openrouter.md)

## Configuring Grok in Switchmaxxer

Three CLI calls, in order: provider, model, route.

```bash
# 1. provider — references the env var by name; does not store the key itself
switchmaxxer providers create grok \
  --endpoint "https://api.x.ai/v1/chat/completions" \
  --api-mode openai-completions \
  --api-key-env SWITCHMAXXER_GROK_API_KEY

# 2. model — see "Cost Estimation" below for unit semantics and source
switchmaxxer models create grok-4-fast \
  --display-name "Grok 4 Fast" \
  --model-creator xai \
  --cost-input 0.20 \
  --cost-output 0.50 \
  --cost-cache-read 0.05 \
  --cost-cache-write 0.20

# 3. route — what clients point at; provider-model-id is what's forwarded upstream
switchmaxxer routes create grok-4-fast-direct \
  --model grok-4-fast \
  --service-provider grok \
  --provider-model-id grok-4-fast \
  --display-name "Grok 4 Fast (direct)" \
  --timeout-ms 90000
```

The env var name `SWITCHMAXXER_GROK_API_KEY` follows Switchmaxxer's `SWITCHMAXXER_<PROVIDER>_API_KEY` convention. The actual secret value must be present in the gateway process's environment when the gateway starts; how it gets there (shell `export`, systemd unit `Environment=`, `~/.config/switchmaxxer/secrets.json` via the JSON-format secrets loader at [src/subsystems/config/secrets.ts](../../../src/subsystems/config/secrets.ts), or `SWITCHMAXXER_SECRETS_PATH` pointing at an explicit file) is an operator-side concern, not a Grok-specific one.

The `--timeout-ms 90000` mirrors the Gemini route's longer timeout because reasoning-capable Grok variants can take meaningfully longer than non-reasoning chat models on hard prompts.

## Cost Estimation

Switchmaxxer's `CostConfig` has four fields — `input`, `output`, `cacheRead`, `cacheWrite` — and the optimize subsystem treats each value as **USD per 1,000,000 tokens** of the corresponding category. The score formula is documented in [docs/subsystems/observability/contracts/tech-spec-for-optimize-command.md](../../subsystems/observability/contracts/tech-spec-for-optimize-command.md):

```
score =
  (input_tokens / 1_000_000) * cost.input +
  (output_tokens / 1_000_000) * cost.output +
  (cache_read_tokens / 1_000_000) * cost.cacheRead +
  (cache_write_tokens / 1_000_000) * cost.cacheWrite
```

So `--cost-input 0.20` means $0.20 per 1M input tokens.

The numbers used above for `grok-4-fast` were derived from xAI's published pricing at https://docs.x.ai/docs/models#models-and-pricing during initial wiring:

| Switchmaxxer field | Value (USD / 1M tokens) | Source / mapping                                                                                  |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `cost.input`       | 0.20                    | Grok 4 Fast input price                                                                           |
| `cost.output`      | 0.50                    | Grok 4 Fast output price                                                                          |
| `cost.cacheRead`   | 0.05                    | Cached-input price (xAI's prompt-caching discount on the input rate)                              |
| `cost.cacheWrite`  | 0.20                    | xAI does not bill a separate cache-write event; first write is charged at full input rate. Use `cost.input` as the proxy. |

Caveats and known imprecisions:

- xAI's pricing page changes — Grok pricing has been adjusted multiple times since the API launched. Treat the table above as a snapshot rather than a contract; re-verify before relying on Switchmaxxer optimize output for purchasing decisions.
- Each Grok variant has its own pricing — `grok-4` (flagship), `grok-4-fast`, `grok-code-fast-1`, and any future tiers are priced independently. The table above is for `grok-4-fast` specifically. Add other Grok models with their own `models create ...` calls and their own cost numbers.
- Reasoning-capable Grok variants bill **reasoning tokens** as part of output, with potentially much higher effective output volumes than non-reasoning models. The four-field `CostConfig` cannot distinguish reasoning tokens from regular output, so cost scores for reasoning-mode routes will be approximations that depend on actual reasoning depth.
- xAI offers **higher-context tiers** (e.g. above 128K tokens of input) at different per-token rates. The four-field `CostConfig` cannot represent context-window-tiered pricing, so requests that cross those thresholds will be modeled at the base-tier rate and underestimated in cost.
- xAI has historically run **promotional credit** programs (free monthly credits if data sharing is enabled, occasional free-tier windows on specific models). If you're operating under one of those, configure cost zeros and watch for the program ending.
- Vision input on vision-capable Grok variants and any tool-use surcharges (where they exist) are not separately modeled.
