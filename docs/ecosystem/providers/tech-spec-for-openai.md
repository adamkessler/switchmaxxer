# Switchmaxxer OpenAI Provider Tech Spec

This document captures how OpenAI's API platform fits into Switchmaxxer as an upstream service provider, the endpoint surface Switchmaxxer talks to, the dialect constraints that determine which API mode is used, and the cost numbers used to populate model metadata.

Documentation placement note:

- this document lives under `docs/ecosystem/providers/` because OpenAI is an external upstream, not a Switchmaxxer-owned subsystem
- it should not be moved into `docs/swe/` or `docs/subsystems/`; those trees are for Switchmaxxer-internal engineering and component specs
- the organizing principle is domain ownership first: this file is a boundary document describing how Switchmaxxer integrates with a third-party API surface

## Background: OpenAI's API Surfaces

OpenAI exposes its models through several surfaces with different audiences and authentication models:

- **OpenAI API platform on `api.openai.com`** — the developer-facing surface, documented at https://platform.openai.com/docs. Authenticated with an API key minted at https://platform.openai.com/api-keys. This is the surface Switchmaxxer integrates with.
- **Azure OpenAI Service on `*.openai.azure.com`** — the Microsoft Azure surface, authenticated with Azure AD / API keys scoped to a deployment, billed through Azure. Same models, different lifecycle and SLAs. Out of scope for this integration.
- **ChatGPT (consumer) on `chat.openai.com` / `chatgpt.com`** — the end-user product, not an API. Not relevant here.

Within `api.openai.com` itself, the platform exposes several historically-distinct request shapes:

- **Chat Completions** at `/v1/chat/completions` — the long-running standard for multi-turn chat with messages and tool calls. This is the shape Switchmaxxer uses.
- **Responses API** at `/v1/responses` — the newer unified surface that bundles chat, tools, file inputs, and built-in agents. Increasingly the recommended path for new OpenAI features. Switchmaxxer's `openai-completions` mode does not currently target this endpoint.
- **(Legacy) Completions** at `/v1/completions` — the original text-completion shape (`prompt` in, `text` out). Effectively retired for new models.

The current production model lineup includes the GPT-4o family (omni-modal), the GPT-4.1 family (long-context text), the o-series reasoning models (`o1`, `o3`, etc.), and the smaller `*-mini` and `*-nano` variants positioned for cheap high-volume work.

## Endpoint Information

Switchmaxxer talks to OpenAI through the Chat Completions endpoint:

- **Base URL:** `https://api.openai.com/v1/`
- **Chat completions endpoint:** `https://api.openai.com/v1/chat/completions`
- **Auth:** API key in the `Authorization: Bearer <key>` header. Optionally `OpenAI-Organization` and `OpenAI-Project` headers for org/project scoping; Switchmaxxer does not currently set those.

A trivial liveness check that exercises auth and lists models without spending tokens:

```bash
curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer $SWITCHMAXXER_OPENAI_API_KEY" | head
```

A 200 response listing models confirms the key is valid. A 401 means the key is wrong, missing, or revoked.

## API Mode Selection: Why `openai-completions`

OpenAI's Chat Completions endpoint is the dialect that `openai-completions` was designed around — Switchmaxxer's request/response wire format for that mode is the OpenAI Chat Completions wire format, full stop. Switchmaxxer only supports `openai-completions` and `anthropic-messages` ([src/platform/types.ts:3](../../../src/platform/types.ts#L3)), so this is the natural fit.

Practical implications:

- inbound OpenAI-dialect requests pass straight through as the upstream wire format
- inbound Anthropic-dialect requests are translated to the OpenAI shape before being forwarded to OpenAI
- response and streaming SSE format upstream is OpenAI's, and gets translated back if the inbound dialect was Anthropic
- Responses-API-only features (built-in tools, multi-step agentic flows expressed in the `/v1/responses` shape) are not reachable through `openai-completions`. If first-class Responses API support is wanted, that would require a new `api_mode` (e.g. `openai-responses`) and corresponding inbound translators

## Configuring OpenAI in Switchmaxxer

Three CLI calls, in order: provider, model, route. The provider holds the endpoint and auth lookup, the model is the canonical local identifier with cost metadata, and the route binds them together with the upstream model id Switchmaxxer forwards to OpenAI.

```bash
# 1. provider — references the env var by name; does not store the key itself
switchmaxxer providers create openai_direct \
  --endpoint "https://api.openai.com/v1/chat/completions" \
  --api-mode openai-completions \
  --api-key-env SWITCHMAXXER_OPENAI_API_KEY

# 2. model — see "Cost Estimation" below for unit semantics and source
switchmaxxer models create gpt-4o-mini \
  --display-name "GPT-4o-Mini" \
  --model-creator openai \
  --cost-input 0.15 \
  --cost-output 0.60 \
  --cost-cache-read 0.075 \
  --cost-cache-write 0.15

# 3. route — what clients point at; provider-model-id is what's forwarded upstream
switchmaxxer routes create gpt-4o-mini-direct \
  --model gpt-4o-mini \
  --service-provider openai_direct \
  --provider-model-id gpt-4o-mini \
  --display-name "GPT-4o-Mini (direct)" \
  --timeout-ms 15000
```

The env var name `SWITCHMAXXER_OPENAI_API_KEY` follows Switchmaxxer's `SWITCHMAXXER_<PROVIDER>_API_KEY` convention. The actual secret value must be present in the gateway process's environment when the gateway starts; how it gets there (shell `export`, systemd unit `Environment=`, `~/.config/switchmaxxer/secrets.json` via the JSON-format secrets loader at [src/subsystems/config/secrets.ts](../../../src/subsystems/config/secrets.ts), or `SWITCHMAXXER_SECRETS_PATH` pointing at an explicit file) is an operator-side concern, not an OpenAI-specific one.

## Cost Estimation

Switchmaxxer's `CostConfig` has four fields — `input`, `output`, `cacheRead`, `cacheWrite` — and the optimize subsystem treats each value as **USD per 1,000,000 tokens** of the corresponding category. The score formula is documented in [docs/subsystems/observability/tech-spec-for-optimize-command.md](../../subsystems/observability/tech-spec-for-optimize-command.md):

```
score =
  (input_tokens / 1_000_000) * cost.input +
  (output_tokens / 1_000_000) * cost.output +
  (cache_read_tokens / 1_000_000) * cost.cacheRead +
  (cache_write_tokens / 1_000_000) * cost.cacheWrite
```

So `--cost-input 0.15` means $0.15 per 1M input tokens.

The numbers used above for `gpt-4o-mini` were derived from OpenAI's published pricing at https://openai.com/api/pricing/ at the time the model was added to the catalog:

| Switchmaxxer field | Value (USD / 1M tokens) | Source / mapping                                                                                            |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `cost.input`       | 0.15                    | GPT-4o-mini standard input price                                                                            |
| `cost.output`      | 0.60                    | GPT-4o-mini output price                                                                                    |
| `cost.cacheRead`   | 0.075                   | Cached-input price (50% of standard input under OpenAI's prompt caching)                                    |
| `cost.cacheWrite`  | 0.15                    | OpenAI does not bill a separate cache-write event; the first write is charged at full input rate. Use `cost.input` as the proxy. |

Caveats and known imprecisions:

- OpenAI's pricing page changes periodically; treat the table above as a snapshot rather than a contract. Re-verify before relying on Switchmaxxer optimize output for purchasing decisions.
- OpenAI does not currently expose a per-token "cache write" line item — prompt caching is implemented as a discount on cache hits, with the first send paying full input price. Modeling `cacheWrite = cost.input` is a faithful approximation for that economics.
- Reasoning models (`o1`, `o3`, etc.) bill **reasoning tokens** as part of output, with significantly higher per-token output rates than non-reasoning models. The four-field `CostConfig` cannot distinguish reasoning tokens from regular output, so cost scores for reasoning-model routes will be approximations that depend on actual reasoning depth.
- Vision/audio inputs and structured-output / tool-call surcharges (where they exist) are not separately modeled.
- Each OpenAI model has its own pricing — the table above is for `gpt-4o-mini` specifically. Add other OpenAI models with their own `models create ...` calls and their own cost numbers.
