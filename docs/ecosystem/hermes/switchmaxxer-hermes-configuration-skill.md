# Skill: Switchmaxxer Hermes Configuration

## Purpose

Use this skill when you need to understand, review, or modify a Hermes configuration so Hermes talks to Switchmaxxer correctly.

This skill is for agentic use. It is not a general Hermes architecture spec. It is a practical guide for answering questions like:

- "Why is Hermes not hitting Switchmaxxer?"
- "How should Hermes be pointed at the Anthropic listener?"
- "What part of Hermes config decides the transport format?"
- "How do I verify that Hermes is using the intended Switchmaxxer route?"

## When To Use This Skill

Use this skill when:

- the task involves `~/.hermes/config.yaml`
- Hermes is expected to send model traffic through Switchmaxxer
- you need to reason about Hermes provider selection, base URLs, or transport mode
- you are preparing an integration plan or troubleshooting guide for Hermes + Switchmaxxer

Do not use this skill when:

- the task is about OpenClaw instead of Hermes
- the task is about generic Switchmaxxer routing with no Hermes-specific behavior
- the question is only about Switchmaxxer config and not the Hermes side

## Core Mental Model

Hermes decides both:

- which provider entry to use
- which wire format to emit

For a Switchmaxxer-backed Hermes setup, the most important facts are:

1. Hermes chooses a provider from `model.provider`.
2. That provider is usually defined in `custom_providers`.
3. The selected provider's `base_url` and `api_mode` determine how Hermes speaks to Switchmaxxer.
4. For Anthropic Messages mode, Hermes should target the Switchmaxxer Anthropic listener:

```text
http://localhost:4080/anthropic
```

5. The route Hermes asks for is usually the value in `model.default`.

In other words:

- Hermes provider choice picks the endpoint and protocol
- Hermes model choice picks the Switchmaxxer route name

One important distinction:

- Hermes uses its own `api_mode` spellings such as `chat_completions` and `anthropic_messages`
- Switchmaxxer normalizes incoming config/provider definitions into canonical internal values:
  - `openai-completions`
  - `anthropic-messages`

So when reasoning about Hermes config, keep two layers separate:

- Hermes-side value names
- Switchmaxxer-side canonical value names

## Inspection Headers

Hermes does not need to send Switchmaxxer inspection headers for ordinary model
traffic.

The headers `x-switchmaxxer-inspect`, `x-switchmaxxer-inspect-id`, and
`x-switchmaxxer-inspect-token` are for Switchmaxxer's local operator debugging
flow only:

- `x-switchmaxxer-inspect: 1` asks the gateway to create an ephemeral capture
- `x-switchmaxxer-inspect-id` and `x-switchmaxxer-inspect-token` are returned
  by the gateway with the allocated capture id and one-time read token

If Hermes cannot emit those custom headers out of the box, that does not block a
Hermes-to-Switchmaxxer integration. It only means Hermes itself will not initiate
the optional `smx invoke --inspect` capture flow; operators can still reproduce a
single request with the CLI when they need four-hop debugging.

## The Key Configuration Shape

The most important Hermes configuration pattern for Switchmaxxer looks like this:

```yaml
model:
  default: MiniMax-M2.7-highspeed
  provider: switchmaxxer

custom_providers:
  - name: switchmaxxer
    base_url: http://localhost:4080/anthropic
    api_key: none
    api_mode: anthropic_messages
```

Interpretation:

- Hermes will send requests for route `MiniMax-M2.7-highspeed`
- Hermes will send them to the custom provider named `switchmaxxer`
- Hermes will speak Anthropic Messages format
- Hermes will hit the Switchmaxxer Anthropic listener at `/anthropic`

## Files And Code Paths To Check

Primary user-facing Hermes files:

- `~/.hermes/config.yaml`
- `~/.hermes/.env`

Important Hermes code references from the original analysis:

- `hermes-agent/hermes_cli/config.py`
- `hermes-agent/gateway/config.py`
- `hermes-agent/gateway/run.py`
- `hermes-agent/run_agent.py`
- `hermes-agent/agent/auxiliary_client.py`
- `hermes-agent/agent/smart_model_routing.py`

If you need to inspect Hermes behavior, start with:

1. config loading in `hermes_cli/config.py`
2. gateway-specific bridging in `gateway/config.py`
3. runtime provider selection in `gateway/run.py` and `run_agent.py`

## What Matters Most

### 1. `model.default`

This is usually the route name Hermes passes to Switchmaxxer.

For a Switchmaxxer integration, confirm that:

- the value matches a real Switchmaxxer route
- the route is available on the intended listener

Example:

```yaml
model:
  default: claude-sonnet-4-6
```

That means Hermes is likely asking Switchmaxxer for route `claude-sonnet-4-6`.

### 2. `model.provider`

This selects the Hermes provider definition to use.

For Switchmaxxer-backed traffic, this should usually point at a custom provider entry such as:

```yaml
model:
  provider: switchmaxxer
```

### 3. `custom_providers`

This is usually where the Switchmaxxer endpoint is defined.

The key fields are:

- `name`
- `base_url`
- `api_key`
- `api_mode`
- `models` if present

For Switchmaxxer, the most important correctness checks are:

- the provider name matches `model.provider`
- the `base_url` points at the correct Switchmaxxer listener
- the `api_mode` matches that listener

### 4. `base_url`

This decides where Hermes sends requests.

Common shapes:

- OpenAI-compatible listener:

```text
http://localhost:4080
```

- Anthropic-compatible listener:

```text
http://localhost:4080/anthropic
```

If Hermes is supposed to emit Anthropic Messages requests, the base URL should usually end in `/anthropic`.

### 5. `api_mode`

This decides the request dialect Hermes emits.

Common Hermes values:

- `chat_completions`
- `anthropic_messages`

Switchmaxxer canonical values:

- `openai-completions`
- `anthropic-messages`

Normalization rule:

- Hermes `chat_completions` maps cleanly to Switchmaxxer `openai-completions`
- Hermes `anthropic_messages` maps cleanly to Switchmaxxer `anthropic-messages`

The critical invariant is still:

- `anthropic_messages` should point at the Switchmaxxer Anthropic listener
- `chat_completions` should point at the Switchmaxxer OpenAI-compatible listener

For agent output, prefer wording like:

- "Hermes is configured with `api_mode: anthropic_messages`"
- "Switchmaxxer will treat that as `anthropic-messages` internally"

## Troubleshooting Checklist

When Hermes is not working with Switchmaxxer, check these in order:

1. Does `model.provider` point to the intended provider entry?
2. Does that provider entry exist in `custom_providers`?
3. Does the provider `base_url` point to the correct Switchmaxxer listener?
4. Does Hermes `api_mode` match the listener?
5. Does `model.default` match a real Switchmaxxer route?
6. Is that route compatible with the selected listener?
7. Is the Switchmaxxer gateway actually running?
8. Does `switchmaxxer gateway status --json` show the expected config and route count?
9. Can the same route be tested through the gateway with `switchmaxxer test --route <route>` or `switchmaxxer invoke --route <route> ...`, and directly with `switchmaxxer test --route <route> --no-gateway`?
10. For one non-streaming reproduction, does `switchmaxxer invoke --route <route> ... --inspect` show the expected client request, proxied provider request, upstream response, and final client response?
11. If the request reaches Switchmaxxer but still fails, do `switchmaxxer gateway logs show --format json --lines 50` or `switchmaxxer gateway logs tail --format json` show the expected `request_id` and debug lifecycle events?

## Common Failure Patterns

### Wrong listener

Symptom:

- Hermes is configured for Anthropic Messages, but the base URL is `http://localhost:4080` instead of `http://localhost:4080/anthropic`

Likely result:

- Hermes emits the wrong protocol for the intended route or fails to enter Anthropic Messages mode

### Wrong `api_mode`

Symptom:

- Hermes `api_mode` says `chat_completions`, but the route and endpoint were intended for Anthropic Messages

Likely result:

- format mismatch before Switchmaxxer even processes the request correctly

### Route name does not exist in Switchmaxxer

Symptom:

- `model.default` names a model/provider concept rather than a real Switchmaxxer route

Likely result:

- route-not-found behavior from Switchmaxxer

### Listener incompatibility

Symptom:

- Hermes uses an Anthropic listener for a route that only works on the OpenAI-compatible listener

Likely result:

- Switchmaxxer rejects the request at the boundary

## Recommended Agent Workflow

When using this skill, follow this sequence:

1. Read `~/.hermes/config.yaml`.
2. Find `model.default` and `model.provider`.
3. Find the matching provider entry in `custom_providers`.
4. Record:
   - selected route
   - selected provider
   - base URL
   - Hermes API mode
   - expected Switchmaxxer canonical API mode
5. Compare that against the intended Switchmaxxer listener:
   - `/v1/chat/completions` path family for OpenAI-compatible traffic
   - `/anthropic/v1/messages` path family for Anthropic-compatible traffic
6. Verify the named route exists in Switchmaxxer config.
7. State clearly whether the issue is:
   - Hermes config
   - Switchmaxxer route/config
   - listener mismatch
   - provider/runtime availability

## Output Template

When reporting findings, prefer this shape:

### Summary

- Hermes is configured to use provider `<provider>`
- Hermes is requesting route `<route>`
- Hermes is speaking `<hermes_api_mode>`
- Switchmaxxer will canonicalize that to `<switchmaxxer_api_mode>`
- Hermes is targeting `<base_url>`

### Assessment

- This is correct / incorrect for the intended Switchmaxxer setup because `<reason>`

### Next Fix

- Change `<field>` from `<old>` to `<new>`
- or verify Switchmaxxer route `<route>`
- or switch Hermes to the correct listener/API mode pairing
- or use the current gateway log surface to confirm where the request failed by `request_id` and `debug_error_context stage=...`

## Safe Recommendations

Prefer these recommendations:

- keep Switchmaxxer route names explicit
- keep Hermes provider definitions thin and local
- prefer one clearly named `switchmaxxer` provider entry
- use `/anthropic` only when Hermes should emit Anthropic Messages traffic
- avoid mixing route intent, provider identity, and transport format in one sentence
- when troubleshooting live failures, prefer `switchmaxxer gateway logs show|tail` first, then use `switchmaxxer trace list|show|observations` when persisted request history is needed

## Short Reference

If Hermes should talk to the Switchmaxxer Anthropic listener, the usual shape is:

```yaml
model:
  default: claude-sonnet-4-6
  provider: switchmaxxer

custom_providers:
  - name: switchmaxxer
    base_url: http://localhost:4080/anthropic
    api_key: none
    api_mode: anthropic_messages
```

Switchmaxxer canonical interpretation:

- route: `claude-sonnet-4-6`
- api mode: `anthropic-messages`

If Hermes should talk to the Switchmaxxer OpenAI-compatible listener, the usual shape is:

```yaml
model:
  default: gpt-4o-mini
  provider: switchmaxxer

custom_providers:
  - name: switchmaxxer
    base_url: http://localhost:4080
    api_key: none
    api_mode: chat_completions
```

Switchmaxxer canonical interpretation:

- route: `gpt-4o-mini`
- api mode: `openai-completions`
