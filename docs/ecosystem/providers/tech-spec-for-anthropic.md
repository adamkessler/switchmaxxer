# Switchmaxxer Anthropic Provider Tech Spec

This document captures how Anthropic's API fits into Switchmaxxer as an upstream service provider, the endpoint surface Switchmaxxer talks to, the dialect constraints that determine which API mode is used, and the cost numbers used to populate model metadata.

Documentation placement note:

- this document lives under `docs/ecosystem/providers/` because Anthropic is an external upstream, not a Switchmaxxer-owned subsystem
- it should not be moved into `docs/swe/` or `docs/subsystems/`; those trees are for Switchmaxxer-internal engineering and component specs
- the organizing principle is domain ownership first: this file is a boundary document describing how Switchmaxxer integrates with a third-party API surface

## Background: Anthropic's API Surfaces

Anthropic exposes Claude through three distinct surfaces with different authentication and billing:

- **Anthropic API on `api.anthropic.com`** — the developer-facing surface, documented at https://docs.anthropic.com/en/api/. Authenticated with an API key minted at https://console.anthropic.com/settings/keys. This is the surface Switchmaxxer integrates with.
- **AWS Bedrock** — Claude is available as a Bedrock-hosted model under `bedrock-runtime.<region>.amazonaws.com`. Authenticated with AWS IAM credentials, billed through AWS. Out of scope for this integration.
- **Google Cloud Vertex AI** — Claude is also available as a Vertex publisher model under `*-aiplatform.googleapis.com/.../publishers/anthropic/models/...`. Authenticated with GCP credentials, billed through GCP. Out of scope.

Within `api.anthropic.com` itself, the principal endpoint is the **Messages API** (`/v1/messages`). The older `/v1/complete` text-completion endpoint is deprecated and is not the path Switchmaxxer uses.

The current Claude family includes the Opus, Sonnet, and Haiku tiers, with a generation suffix (e.g. Claude Sonnet 4.6 / Opus 4.7 / Haiku 4.5). Anthropic supports prompt caching with explicit `cache_control` markers in the request body and a separate per-token rate for cache reads vs cache writes — this matches Switchmaxxer's four-field `CostConfig` more directly than most providers.

The Messages API requires an `anthropic-version` header (currently the canonical value is `2023-06-01`) — Switchmaxxer surfaces this as a per-provider configuration field.

## Endpoint Information

Switchmaxxer talks to Anthropic through the Messages endpoint:

- **Base URL:** `https://api.anthropic.com/v1/`
- **Messages endpoint:** `https://api.anthropic.com/v1/messages`
- **Auth:** API key in the `x-api-key: <key>` header (not bearer)
- **Required headers:** `anthropic-version: 2023-06-01`, plus the standard `content-type: application/json`. Optional `anthropic-beta` header to opt into beta features (Switchmaxxer does not currently set this).

A trivial liveness check that exercises auth without spending many tokens:

```bash
curl -s https://api.anthropic.com/v1/messages \
  -H "x-api-key: $SWITCHMAXXER_ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' | head
```

A 200 response with a `content` array confirms the key is valid. A 401 with `authentication_error` means the key is wrong, missing, or revoked.

## API Mode Selection: Why `anthropic-messages`

The Messages API is exactly the dialect that `anthropic-messages` was designed around — Switchmaxxer's request/response wire format for that mode is Anthropic's Messages wire format, full stop. Switchmaxxer only supports `openai-completions` and `anthropic-messages` ([src/platform/types.ts:3](../../../src/platform/types.ts#L3)), so this is the natural fit.

Practical implications:

- inbound Anthropic-dialect requests pass straight through as the upstream wire format, including `cache_control` markers and `anthropic-beta` semantics that the gateway honors
- inbound OpenAI-dialect requests are translated to the Messages shape before being forwarded to Anthropic
- response and streaming SSE format upstream is Anthropic's, and gets translated back if the inbound dialect was OpenAI
- the `--anthropic-version <value>` flag at provider creation time controls the `anthropic-version` header sent on every upstream request; pin this to a version your client code has been tested against

## Configuring Anthropic in Switchmaxxer

Three CLI calls, in order: provider, model, route. The provider holds the endpoint, auth lookup, and `anthropic-version`; the model is the canonical local identifier with cost metadata; the route binds them together with the upstream model id Switchmaxxer forwards to Anthropic.

```bash
# 1. provider — note the explicit --anthropic-version flag
switchmaxxer providers create anthropic_direct \
  --endpoint "https://api.anthropic.com/v1/messages" \
  --api-mode anthropic-messages \
  --anthropic-version 2023-06-01 \
  --api-key-env SWITCHMAXXER_ANTHROPIC_API_KEY

# 2. model — see "Cost Estimation" below for unit semantics and source
switchmaxxer models create claude-sonnet-4-6 \
  --display-name "Claude Sonnet 4.6" \
  --model-creator anthropic \
  --cost-input 3 \
  --cost-output 15 \
  --cost-cache-read 0.30 \
  --cost-cache-write 3.75

# 3. route — what clients point at; provider-model-id is what's forwarded upstream
switchmaxxer routes create claude-sonnet-direct \
  --model claude-sonnet-4-6 \
  --service-provider anthropic_direct \
  --provider-model-id claude-sonnet-4-6 \
  --display-name "Claude Sonnet 4.6 (direct)" \
  --timeout-ms 15000
```

The env var name `SWITCHMAXXER_ANTHROPIC_API_KEY` follows Switchmaxxer's `SWITCHMAXXER_<PROVIDER>_API_KEY` convention. The actual secret value must be present in the gateway process's environment when the gateway starts; how it gets there (shell `export`, systemd unit `Environment=`, `~/.config/switchmaxxer/secrets.json` via the JSON-format secrets loader at [src/subsystems/config/secrets.ts](../../../src/subsystems/config/secrets.ts), or `SWITCHMAXXER_SECRETS_PATH` pointing at an explicit file) is an operator-side concern, not an Anthropic-specific one.

## Cost Estimation

Switchmaxxer's `CostConfig` has four fields — `input`, `output`, `cacheRead`, `cacheWrite` — and the optimize subsystem treats each value as **USD per 1,000,000 tokens** of the corresponding category. The score formula is documented in [docs/subsystems/observability/contracts/tech-spec-for-optimize-command.md](../../subsystems/observability/contracts/tech-spec-for-optimize-command.md):

```
score =
  (input_tokens / 1_000_000) * cost.input +
  (output_tokens / 1_000_000) * cost.output +
  (cache_read_tokens / 1_000_000) * cost.cacheRead +
  (cache_write_tokens / 1_000_000) * cost.cacheWrite
```

So `--cost-input 3` means $3.00 per 1M input tokens.

The numbers used above for `claude-sonnet-4-6` were derived from Anthropic's published pricing at https://www.anthropic.com/pricing at the time the model was added to the catalog:

| Switchmaxxer field | Value (USD / 1M tokens) | Source / mapping                                                                              |
| ------------------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| `cost.input`       | 3.00                    | Sonnet base input price                                                                       |
| `cost.output`      | 15.00                   | Sonnet output price                                                                           |
| `cost.cacheRead`   | 0.30                    | Cache-read price (10% of base input under Anthropic's prompt caching)                         |
| `cost.cacheWrite`  | 3.75                    | 5-minute ephemeral cache-write price (1.25× base input)                                       |

Caveats and known imprecisions:

- Anthropic's pricing page changes periodically; treat the table above as a snapshot rather than a contract. Re-verify before relying on Switchmaxxer optimize output for purchasing decisions.
- Anthropic offers two cache TTL tiers (5-minute ephemeral and 1-hour); the table above models the 5-minute tier. The 1-hour tier has a higher write multiplier (~2× input). The four-field `CostConfig` cannot distinguish between them, so workloads that explicitly use 1-hour caching will be modeled slightly low.
- Anthropic also offers a **Batch API** at ~50% off both input and output; routes that go through the batch surface are not represented by these numbers.
- Each Claude tier has its own pricing — Opus is meaningfully more expensive than Sonnet, Haiku is meaningfully cheaper. The table above is for Sonnet 4.6 specifically. Add other Claude models with their own `models create ...` calls and their own cost numbers.
- Cost scores assume the request actually opts into prompt caching via `cache_control` markers; requests without those markers will not generate `cache_read_tokens` / `cache_write_tokens` in the observation, so the cache columns drop out of the score naturally.
