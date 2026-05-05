# Switchmaxxer Gemini Provider Tech Spec

This document captures how Google's Gemini API fits into Switchmaxxer as an upstream service provider, the endpoint surface Switchmaxxer talks to, the dialect constraints that determine which API mode is used, and the cost numbers used to populate model metadata.

Documentation placement note:

- this document lives under `docs/ecosystem/providers/` because Gemini is an external upstream, not a Switchmaxxer-owned subsystem
- it should not be moved into `docs/swe/` or `docs/subsystems/`; those trees are for Switchmaxxer-internal engineering and component specs
- the organizing principle is domain ownership first: this file is a boundary document describing how Switchmaxxer integrates with a third-party API surface

## Background: Gemini in Google's Ecosystem

Google offers Gemini through two distinct API surfaces with different audiences:

- **Gemini API (a.k.a. the "Generative Language API") on `generativelanguage.googleapis.com`** — the developer-facing surface, documented at https://ai.google.dev/. Authenticated with an API key minted in Google AI Studio (https://aistudio.google.com/apikey). This is the descendant of the older PaLM-era API: same hostname, same docs site, but the PaLM models (`text-bison`, `chat-bison`, `embedding-gecko`) and their `:generateText` / `:generateMessage` / `:embedText` methods were retired in 2024 in favor of the Gemini family with `:generateContent`.
- **Vertex AI Gemini on `*-aiplatform.googleapis.com`** — the Google Cloud surface, authenticated with GCP credentials, billed through a Cloud project, and pathed under `publishers/google/models/...`. Targets enterprises already on Vertex.

Switchmaxxer integrates with the first surface — the AI Studio / `generativelanguage.googleapis.com` API — because it is the simpler, API-key-authenticated path that matches Switchmaxxer's existing per-provider auth model.

The Gemini family currently exposes Gemini 2.x text/multimodal models. Older Gemini 1.0 / 1.5 model IDs have been deprecated in waves; current production models are the 2.x line (e.g. `gemini-2.5-flash`, `gemini-2.5-pro`).

## Endpoint Information

Switchmaxxer talks to Gemini through Google's **OpenAI-compatible** endpoint, not the native `:generateContent` surface:

- **Base URL:** `https://generativelanguage.googleapis.com/v1beta/openai/`
- **Chat completions endpoint:** `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- **Auth:** API key in the `Authorization: Bearer <key>` header (the OpenAI-compatible surface uses bearer auth; the native surface uses the `?key=` query parameter)

The same hostname also exposes the native Gemini dialect at `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (and `:streamGenerateContent`), which is what `ai.google.dev` documents as the primary API. Switchmaxxer does not use that path (see next section).

A trivial liveness check using the OpenAI-compatible surface:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$SWITCHMAXXER_GEMINI_API_KEY" | head
```

A 200 response listing models confirms the key is valid and the Generative Language API is enabled on the underlying Google Cloud project.

## API Mode Selection: Why `openai-completions`

Gemini exposes an OpenAI-compatible surface at `/v1beta/openai/`, so `openai-completions` works. Switchmaxxer only supports `openai-completions` and `anthropic-messages` ([src/platform/types.ts:3](../../../src/platform/types.ts#L3)) — Gemini's native `:generateContent` dialect is not a supported `api_mode`.

Practical implications of this choice:

- inbound OpenAI-dialect requests pass through cleanly, and Anthropic-dialect inbound requests are translated to the OpenAI shape before being forwarded
- the upstream request body, response shape, and streaming SSE format are the OpenAI Chat Completions wire format, not Google's native `Content[]` / `parts[]` structure
- features that are only expressible in Google's native dialect (e.g. some grounding / safety / structured output configurations specific to `:generateContent`) are not reachable through this integration today
- if first-class native-dialect support is wanted in the future, that would require a new `api_mode` (e.g. `gemini-generate-content`) and corresponding inbound translators — not a configuration change

## Configuring Gemini in Switchmaxxer

Three CLI calls, in order: provider, model, route. The provider holds the endpoint and auth lookup, the model is the canonical local identifier with cost metadata, and the route binds them together with the upstream model id Switchmaxxer forwards to Google.

```bash
# 1. provider — references the env var by name; does not store the key itself
switchmaxxer providers create gemini \
  --endpoint "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  --api-mode openai-completions \
  --api-key-env SWITCHMAXXER_GEMINI_API_KEY

# 2. model — see "Cost Estimation" below for unit semantics and source
switchmaxxer models create gemini-2.5-flash \
  --display-name "Gemini 2.5 Flash" \
  --model-creator google \
  --cost-input 0.30 \
  --cost-output 2.50 \
  --cost-cache-read 0.075 \
  --cost-cache-write 0

# 3. route — what clients point at; provider-model-id is what's forwarded upstream
switchmaxxer routes create gemini-flash \
  --model gemini-2.5-flash \
  --service-provider gemini \
  --provider-model-id gemini-2.5-flash \
  --display-name "Gemini 2.5 Flash via Google" \
  --timeout-ms 90000
```

The env var name `SWITCHMAXXER_GEMINI_API_KEY` follows Switchmaxxer's `SWITCHMAXXER_<PROVIDER>_API_KEY` convention. The actual secret value must be present in the gateway process's environment when the gateway starts; how it gets there (shell `export`, systemd unit `Environment=`, `~/.config/switchmaxxer/secrets.json` via the JSON-format secrets loader at [src/subsystems/config/secrets.ts](../../../src/subsystems/config/secrets.ts), or `SWITCHMAXXER_SECRETS_PATH` pointing at an explicit file) is an operator-side concern, not a Gemini-specific one.

## Cost Estimation

Switchmaxxer's `CostConfig` has four fields — `input`, `output`, `cacheRead`, `cacheWrite` — and the optimize subsystem treats each value as **USD per 1,000,000 tokens** of the corresponding category. The score formula is documented in [docs/subsystems/observability/tech-spec-for-optimize-command.md](../../subsystems/observability/tech-spec-for-optimize-command.md):

```
score =
  (input_tokens / 1_000_000) * cost.input +
  (output_tokens / 1_000_000) * cost.output +
  (cache_read_tokens / 1_000_000) * cost.cacheRead +
  (cache_write_tokens / 1_000_000) * cost.cacheWrite
```

So `--cost-input 0.30` means $0.30 per 1M input tokens.

The numbers used above for `gemini-2.5-flash` were derived from Google's published pricing for the Gemini API (text/image/video input, free-vs-paid tier — these are paid-tier figures), retrieved from https://ai.google.dev/gemini-api/docs/pricing during initial wiring:

| Switchmaxxer field | Value (USD / 1M tokens) | Source / mapping                                                                           |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------ |
| `cost.input`       | 0.30                    | Gemini 2.5 Flash text/image/video input price                                              |
| `cost.output`      | 2.50                    | Gemini 2.5 Flash output price (text)                                                       |
| `cost.cacheRead`   | 0.075                   | Gemini 2.5 Flash cached input price (per-token read of context-cached prompts)             |
| `cost.cacheWrite`  | 0                       | Gemini bills cache by storage time, not per-token write events; placeholder until modeled  |

Caveats and known imprecisions:

- Google's pricing page changes; treat the table above as a snapshot rather than a contract. Re-verify before relying on Switchmaxxer optimize output for purchasing decisions.
- Gemini 2.5 Flash has additional pricing dimensions Switchmaxxer's `CostConfig` does not currently model: separate **audio input** rate, separate **thinking-tokens output** rate, **context-window-dependent** tiers (above 200K tokens of input has different rates), and **cache storage time charges**. The four-field `CostConfig` collapses these into a single per-category number, so the cost score is an approximation that will be tighter for short-context, text-only requests and looser for long-context, multimodal, or thinking-heavy workloads.
- The placeholder `0` for `cacheWrite` understates true cache cost. If routing decisions involving Gemini start being driven by cache economics, that field needs a real model — likely amortizing the storage-time charge over an expected lifetime of cached entries.
- If a future Switchmaxxer release adds richer cost dimensions (per-modality input, thinking-vs-output split, tiered context pricing), the Gemini integration should be one of the first providers to take advantage of them — Gemini's pricing model is a fairly close match to those dimensions.
