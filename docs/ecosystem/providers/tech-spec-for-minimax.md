# Switchmaxxer MiniMax Provider Tech Spec

This document captures how MiniMax's API fits into Switchmaxxer as an upstream service provider, the endpoint surface Switchmaxxer talks to, the dialect constraints that determine which API mode is used, and the cost numbers used to populate model metadata.

Documentation placement note:

- this document lives under `docs/ecosystem/providers/` because MiniMax is an external upstream, not a Switchmaxxer-owned subsystem
- it should not be moved into `docs/swe/` or `docs/subsystems/`; those trees are for Switchmaxxer-internal engineering and component specs
- the organizing principle is domain ownership first: this file is a boundary document describing how Switchmaxxer integrates with a third-party API surface

## Background: MiniMax in the Chinese-AI-Lab Ecosystem

MiniMax (上海稀宇科技) is a Shanghai-based AI lab known for the **MiniMax / abab** family of large language models (text), the **speech** family of TTS/voice models, and the **video-01** family of video-generation models. Documented at https://www.minimax.io/platform/document/ (international) and https://platform.minimaxi.com/ (domestic).

MiniMax exposes its API through two regional surfaces that mirror each other but bill in different currencies and have different account systems:

- **International platform on `api.minimax.io`** — billed in USD, signed up for via the international portal at https://www.minimax.io/. This is the surface Switchmaxxer integrates with.
- **Domestic platform on `api.minimaxi.com`** — billed in RMB, signed up for via the domestic portal at https://platform.minimaxi.com/, intended for users inside mainland China.

Within `api.minimax.io`, the platform exposes both a native MiniMax dialect (proprietary request shape, used for some model families and for advanced features like character roleplay) and an **Anthropic-compatible** surface at `/anthropic/v1/messages`. Switchmaxxer uses the Anthropic-compatible surface because it is the dialect that maps cleanly onto Switchmaxxer's `anthropic-messages` `api_mode`.

The current MiniMax LLM family centers on the **MiniMax-M2** generation — a sparse Mixture-of-Experts model — with multiple variants tuned for different latency/quality tradeoffs (e.g. `MiniMax-M2.7-highspeed` is a fast variant with reduced latency relative to the standard model).

## Endpoint Information

Switchmaxxer talks to MiniMax through the Anthropic-compatible Messages endpoint:

- **Base URL:** `https://api.minimax.io/anthropic/v1/`
- **Messages endpoint:** `https://api.minimax.io/anthropic/v1/messages`
- **Auth:** API key in the `x-api-key: <key>` header (matching Anthropic's auth shape, since this is the Anthropic-compat surface)
- **Required headers:** `anthropic-version: 2023-06-01`, plus the standard `content-type: application/json`

A trivial liveness check that exercises auth without spending many tokens:

```bash
curl -s https://api.minimax.io/anthropic/v1/messages \
  -H "x-api-key: $SWITCHMAXXER_MINIMAX_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"MiniMax-M2.7-highspeed","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' | head
```

A 200 response with a `content` array confirms the key is valid. A 401 / `authentication_error` means the key is wrong, missing, or revoked.

## API Mode Selection: Why `anthropic-messages`

MiniMax exposes an Anthropic-compatible surface at `/anthropic/v1/`, so `anthropic-messages` works and is the cleanest fit. Switchmaxxer only supports `openai-completions` and `anthropic-messages` ([src/platform/types.ts:3](../../../src/platform/types.ts#L3)) — MiniMax's native dialect (the proprietary `chatcompletion` / `chatcompletion_v2` shapes documented on the MiniMax platform) is not a supported `api_mode`.

Practical implications of this choice:

- inbound Anthropic-dialect requests pass through cleanly, including `cache_control` markers if MiniMax's compat surface honors them
- inbound OpenAI-dialect requests are translated to the Anthropic Messages shape before being forwarded to MiniMax
- features that are only expressible in MiniMax's native dialect — character/persona roleplay parameters, audio inputs/outputs, video generation — are not reachable through this integration
- if first-class native-dialect support is wanted in the future, that would require a new `api_mode` (e.g. `minimax-chat`) and corresponding inbound translators
- MiniMax's Anthropic-compat surface may not implement every Anthropic feature at full fidelity (cache semantics, tool-use specifics, streaming event ordering); test with realistic workloads before relying on parity

### Tool-Use Translation Notes

MiniMax's Anthropic-compatible surface can return reasoning metadata blocks
such as `thinking` before a valid `tool_use` block. Switchmaxxer's
Anthropic-to-OpenAI translator intentionally ignores `thinking` and
`redacted_thinking` blocks for OpenAI clients, preserves `tool_use.input` as the
OpenAI `tool_calls[].function.arguments` JSON string, and continues to refuse
other unknown content block types.

For streaming translated responses, an empty Anthropic `tool_use.input` at
`content_block_start` becomes an OpenAI tool-call delta with
`function.arguments: ""`; subsequent `input_json_delta` events carry the JSON
fragments. If a local OpenClaw or other OpenAI-compatible client sees empty
tool-call parameters from a MiniMax-backed route, rebuild Switchmaxxer and
restart the gateway before debugging provider behavior.

## Configuring MiniMax in Switchmaxxer

Three CLI calls, in order: provider, model, route.

```bash
# 1. provider — note the explicit --anthropic-version flag for the Anthropic-compat surface
switchmaxxer providers create minimax_direct \
  --endpoint "https://api.minimax.io/anthropic/v1/messages" \
  --api-mode anthropic-messages \
  --anthropic-version 2023-06-01 \
  --api-key-env SWITCHMAXXER_MINIMAX_API_KEY

# 2. model — see "Cost Estimation" below for unit semantics and source
switchmaxxer models create MiniMax-M2.7-highspeed \
  --display-name "MiniMax M2.7 Highspeed" \
  --model-creator minimax \
  --cost-input 0.60 \
  --cost-output 2.40 \
  --cost-cache-read 0.06 \
  --cost-cache-write 0.375

# 3. route — what clients point at; provider-model-id is what's forwarded upstream
switchmaxxer routes create MiniMax-M2.7-highspeed-direct \
  --model MiniMax-M2.7-highspeed \
  --service-provider minimax_direct \
  --provider-model-id MiniMax-M2.7-highspeed \
  --display-name "MiniMax M2.7 Highspeed (direct)" \
  --timeout-ms 15000
```

The env var name `SWITCHMAXXER_MINIMAX_API_KEY` follows Switchmaxxer's `SWITCHMAXXER_<PROVIDER>_API_KEY` convention. The actual secret value must be present in the gateway process's environment when the gateway starts; how it gets there (shell `export`, systemd unit `Environment=`, `~/.config/switchmaxxer/secrets.json` via the JSON-format secrets loader at [src/subsystems/config/secrets.ts](../../../src/subsystems/config/secrets.ts), or `SWITCHMAXXER_SECRETS_PATH` pointing at an explicit file) is an operator-side concern, not a MiniMax-specific one.

## Cost Estimation

Switchmaxxer's `CostConfig` has four fields — `input`, `output`, `cacheRead`, `cacheWrite` — and the optimize subsystem treats each value as **USD per 1,000,000 tokens** of the corresponding category. The score formula is documented in [docs/subsystems/observability/contracts/tech-spec-for-optimize-command.md](../../subsystems/observability/contracts/tech-spec-for-optimize-command.md):

```
score =
  (input_tokens / 1_000_000) * cost.input +
  (output_tokens / 1_000_000) * cost.output +
  (cache_read_tokens / 1_000_000) * cost.cacheRead +
  (cache_write_tokens / 1_000_000) * cost.cacheWrite
```

So `--cost-input 0.60` means $0.60 per 1M input tokens.

The numbers used above for `MiniMax-M2.7-highspeed` were derived from MiniMax's published international pricing at https://www.minimax.io/platform/pricing at the time the model was added to the catalog:

| Switchmaxxer field | Value (USD / 1M tokens) | Source / mapping                                                                             |
| ------------------ | ----------------------- | -------------------------------------------------------------------------------------------- |
| `cost.input`       | 0.60                    | MiniMax-M2.7-highspeed input price (international USD tier)                                  |
| `cost.output`      | 2.40                    | MiniMax-M2.7-highspeed output price                                                          |
| `cost.cacheRead`   | 0.06                    | Cache-read price (10% of base input, matching the Anthropic-compat cache discount pattern)   |
| `cost.cacheWrite`  | 0.375                   | Cache-write price for the ephemeral tier                                                     |

Caveats and known imprecisions:

- MiniMax's pricing pages change periodically and the international (USD) and domestic (RMB) tiers are priced and updated independently. The table above reflects the international tier at one snapshot in time. Re-verify before relying on Switchmaxxer optimize output for purchasing decisions.
- The Anthropic-compat surface's prompt-caching semantics may not be identical to Anthropic's own — cache TTL, eligible content boundaries, and per-token cache rates may differ. The cache numbers above are best-effort estimates; if cost decisions hinge on cache economics, confirm against MiniMax-issued invoices rather than estimates.
- MiniMax has multiple LLM variants (`MiniMax-M2`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`, character-roleplay variants, etc.), each with its own pricing. The table above is for the highspeed variant specifically. Add other MiniMax models with their own `models create ...` calls and their own cost numbers.
- MiniMax also bills for non-LLM modalities (TTS speech, video generation, image generation) on different per-call or per-second rates that are not representable in `CostConfig` at all. Those modalities are out of scope for the Switchmaxxer integration.
