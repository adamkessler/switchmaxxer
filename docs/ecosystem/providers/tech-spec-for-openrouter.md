# Switchmaxxer OpenRouter Provider Tech Spec

This document captures how OpenRouter fits into Switchmaxxer as an upstream service provider, the endpoint surface Switchmaxxer talks to, the dialect constraints that determine which API mode is used, and the cost numbers used to populate model metadata.

Documentation placement note:

- this document lives under `docs/ecosystem/providers/` because OpenRouter is an external upstream, not a Switchmaxxer-owned subsystem
- it should not be moved into `docs/swe/` or `docs/subsystems/`; those trees are for Switchmaxxer-internal engineering and component specs
- the organizing principle is domain ownership first: this file is a boundary document describing how Switchmaxxer integrates with a third-party API surface

## Background: OpenRouter as a Multi-Provider Aggregator

OpenRouter is itself an LLM gateway / aggregator: a single API surface in front of dozens of upstream providers (OpenAI, Anthropic, Google, Meta, Mistral, DeepSeek, x.ai, and many open-source-model hosts). Documented at https://openrouter.ai/docs. Authenticated with an OpenRouter API key minted at https://openrouter.ai/settings/keys.

This places OpenRouter in the same category as Switchmaxxer — both are "single endpoint, many upstreams" — but with very different design choices:

- OpenRouter is SaaS, multi-tenant, and routes traffic through its own backend; Switchmaxxer is local-first and runs on the operator's host
- OpenRouter exposes a flat catalog of `<creator>/<model>` IDs that the operator picks from; Switchmaxxer requires the operator to define routes and bind them to providers explicitly
- OpenRouter charges a small markup on top of the underlying provider's price (and offers some pay-as-you-go credits and free tiers); a Switchmaxxer→direct route avoids that markup but loses OpenRouter's automatic provider failover

A reasonable use of OpenRouter from inside Switchmaxxer is as a **fallback or convenience surface** — one place to reach many models without having to manage every provider's account, with Switchmaxxer's per-route policy and observability still applied on top.

OpenRouter exposes both an **OpenAI-compatible** dialect (its primary surface, at `/api/v1/chat/completions`) and an **Anthropic-compatible** dialect (at `/api/v1/messages`). Switchmaxxer's existing setup uses both, registered as two distinct providers — one per dialect — so that routes can pick whichever dialect matches the underlying model best.

## Endpoint Information

Switchmaxxer talks to OpenRouter through two endpoints:

- **OpenAI-dialect:** `https://openrouter.ai/api/v1/chat/completions` — used for routes whose underlying model is OpenAI/Google/Meta/Mistral/etc., served in OpenAI Chat Completions wire format
- **Anthropic-dialect:** `https://openrouter.ai/api/v1/messages` — used for routes whose underlying model is Anthropic Claude, served in Anthropic Messages wire format. The `anthropic-version` header is required and pinned to `2023-06-01`.
- **Auth (both):** API key in the `Authorization: Bearer <key>` header. Optional `HTTP-Referer` and `X-Title` headers identify the calling app on OpenRouter's leaderboard; Switchmaxxer does not currently set those.

A trivial liveness check that exercises auth and lists OpenRouter's catalog without spending tokens:

```bash
curl -s https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $SWITCHMAXXER_OPENROUTER_API_KEY" | head
```

A 200 response listing models confirms the key is valid. A 401 means the key is wrong, missing, or revoked.

## API Mode Selection: Both Modes, Two Providers

OpenRouter exposes both dialects, and Switchmaxxer only supports `openai-completions` and `anthropic-messages` ([src/platform/types.ts:3](../../../src/platform/types.ts#L3)) — so the cleanest mapping is to register **two** Switchmaxxer providers, one per dialect, both pointing at OpenRouter and both using the same `SWITCHMAXXER_OPENROUTER_API_KEY` env var.

Why two providers and not one? In Switchmaxxer's data model, each provider has a single `api_mode`. A route binds to one provider, so the route's effective dialect is determined at provider-create time. To use OpenRouter's OpenAI-shaped surface from one route and its Anthropic-shaped surface from another, those two routes need two different providers.

Practical implications:

- routes pointing at OpenAI/Google/Meta/Mistral models on OpenRouter use the `openrouter` provider (OpenAI-compatible)
- routes pointing at Anthropic Claude models on OpenRouter use the `openrouter_anthropic` provider (Anthropic-compatible)
- the `--provider-model-id` on each route is the OpenRouter slug, in the form `<creator>/<model>` (e.g. `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4.6`, `meta-llama/llama-3.3-70b-instruct`)
- both providers share the same auth secret; a single OpenRouter key authorizes both surfaces

## Configuring OpenRouter in Switchmaxxer

Two providers, then a model and a route per OpenRouter-served model. Below shows one OpenAI-dialect route and one Anthropic-dialect route as a paired example.

```bash
# 1a. OpenAI-compatible provider
switchmaxxer providers create openrouter \
  --endpoint "https://openrouter.ai/api/v1/chat/completions" \
  --api-mode openai-completions \
  --api-key-env SWITCHMAXXER_OPENROUTER_API_KEY

# 1b. Anthropic-compatible provider (same key, different dialect)
switchmaxxer providers create openrouter_anthropic \
  --endpoint "https://openrouter.ai/api/v1/messages" \
  --api-mode anthropic-messages \
  --anthropic-version 2023-06-01 \
  --api-key-env SWITCHMAXXER_OPENROUTER_API_KEY

# 2a. model entries — the canonical local identifier; see "Cost Estimation" below
#     (these can already exist in the catalog if you registered them via direct providers;
#      OpenRouter routes can reuse the same model entries.)
switchmaxxer models create gpt-4o-mini \
  --display-name "GPT-4o-Mini" --model-creator openai \
  --cost-input 0.15 --cost-output 0.60 --cost-cache-read 0.075 --cost-cache-write 0.15

switchmaxxer models create claude-sonnet-4-6 \
  --display-name "Claude Sonnet 4.6" --model-creator anthropic \
  --cost-input 3 --cost-output 15 --cost-cache-read 0.30 --cost-cache-write 3.75

# 3a. OpenAI-shaped route via OpenRouter
switchmaxxer routes create gpt-4o-mini-via-openrouter \
  --model gpt-4o-mini \
  --service-provider openrouter \
  --provider-model-id openai/gpt-4o-mini \
  --display-name "GPT-4o-Mini (via OpenRouter)" \
  --timeout-ms 15000

# 3b. Anthropic-shaped route via OpenRouter
switchmaxxer routes create claude-sonnet-via-openrouter \
  --model claude-sonnet-4-6 \
  --service-provider openrouter_anthropic \
  --provider-model-id anthropic/claude-sonnet-4.6 \
  --display-name "Claude Sonnet 4.6 (via OpenRouter)" \
  --timeout-ms 15000
```

The env var name `SWITCHMAXXER_OPENROUTER_API_KEY` follows Switchmaxxer's `SWITCHMAXXER_<PROVIDER>_API_KEY` convention. The actual secret value must be present in the gateway process's environment when the gateway starts; how it gets there (shell `export`, systemd unit `Environment=`, `~/.config/switchmaxxer/secrets.json` via the JSON-format secrets loader at [src/subsystems/config/secrets.ts](../../../src/subsystems/config/secrets.ts), or `SWITCHMAXXER_SECRETS_PATH` pointing at an explicit file) is an operator-side concern, not an OpenRouter-specific one.

## Cost Estimation

Switchmaxxer's `CostConfig` has four fields — `input`, `output`, `cacheRead`, `cacheWrite` — and the optimize subsystem treats each value as **USD per 1,000,000 tokens** of the corresponding category. The score formula is documented in [docs/subsystems/observability/tech-spec-for-optimize-command.md](../../subsystems/observability/tech-spec-for-optimize-command.md):

```
score =
  (input_tokens / 1_000_000) * cost.input +
  (output_tokens / 1_000_000) * cost.output +
  (cache_read_tokens / 1_000_000) * cost.cacheRead +
  (cache_write_tokens / 1_000_000) * cost.cacheWrite
```

OpenRouter does not have its own pricing — it reprices each upstream model individually, typically the upstream's published rate plus a small per-call markup (often a few percent, plus a small fixed credit cost on top). The configured numbers above for `gpt-4o-mini` and `claude-sonnet-4-6` mirror the **direct-provider** prices documented in the OpenAI and Anthropic specs in this directory; this is a reasonable approximation but understates the OpenRouter markup.

| Model               | Field            | Value (USD / 1M tokens) | Source                                        |
| ------------------- | ---------------- | ----------------------- | --------------------------------------------- |
| `gpt-4o-mini`       | input            | 0.15                    | OpenAI direct rate (pre-OpenRouter markup)    |
| `gpt-4o-mini`       | output           | 0.60                    | OpenAI direct rate                            |
| `gpt-4o-mini`       | cacheRead        | 0.075                   | OpenAI cached-input rate                      |
| `gpt-4o-mini`       | cacheWrite       | 0.15                    | First-write proxy at full input rate          |
| `claude-sonnet-4-6` | input            | 3.00                    | Anthropic direct Sonnet input rate            |
| `claude-sonnet-4-6` | output           | 15.00                   | Anthropic direct Sonnet output rate           |
| `claude-sonnet-4-6` | cacheRead        | 0.30                    | Anthropic 5-minute cache-read rate            |
| `claude-sonnet-4-6` | cacheWrite       | 3.75                    | Anthropic 5-minute cache-write rate           |

Per-model pricing on OpenRouter is published at https://openrouter.ai/models — drill into a specific model to see its current per-1M-token rates including any OpenRouter markup.

Caveats and known imprecisions:

- The numbers above ignore OpenRouter's markup. For models where the markup is small relative to the underlying price, this is fine; for some long-tail open-source models with very low base rates, the markup is non-trivial in percentage terms.
- OpenRouter sometimes routes a single `<creator>/<model>` slug to multiple upstream providers behind the scenes for failover/load-balancing, with slightly different prices per upstream. The prices above represent the single-upstream economics; in practice the effective rate may vary by a few percent.
- OpenRouter offers free / promotional tiers on some models. If you're using one of those, configure a model entry with cost zeros (and keep an eye on the model's status — free tiers commonly hit hard rate limits or are revoked without warning).
- Each OpenRouter-served model has its own pricing — the table above is for two specific models. Add other models with their own `models create ...` calls and their own cost numbers, sourced from the model's row on https://openrouter.ai/models.
