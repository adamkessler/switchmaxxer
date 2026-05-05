# Tech Spec For API Modes

## Purpose

This document defines the Switchmaxxer concept of `api_mode`.

`api_mode` is a core routing and translation contract. It describes the API dialect spoken on a given side of a request path. It is not a model-vendor label, and it is not limited to message-body structure alone.

This spec exists so product architecture, implementation, observability, CLI surfaces, and future ecosystem integrations all use the same vocabulary and the same mental model.

## Scope

This spec covers:

- the meaning of `api_mode`
- the currently supported API modes
- how API modes differ from model vendor identity
- where API modes apply in Switchmaxxer
- how API modes affect routing and translation
- the main request/response contract differences between modes

This spec does not attempt to fully restate every upstream provider API. It defines the Switchmaxxer abstraction layer over those APIs.

## Canonical Term

The canonical term is `api_mode`.

This term is preferred over older wording like "message format" because the difference between dialects is broader than the shape of `messages` alone. API mode includes:

- endpoint shape
- request body shape
- auth header shape
- response envelope shape
- streaming event shape
- translation rules and expectations

"Message format" may still be used as a narrower subtopic when discussing request-body differences, but it is not the top-level Switchmaxxer term.

## Canonical Values

The current canonical `api_mode` values are:

- `openai-completions`
- `anthropic-messages`

These values describe wire dialects. They do not identify who built the underlying model.

## Definition

An API mode answers this question:

- what API contract is being spoken on this side of the connection?

In Switchmaxxer, that contract may be relevant on both sides of a request path:

- the client-facing listener contract
- the upstream provider contract

This means API mode is a first-class operational concern, not merely a display field.

## Non-Goals

`api_mode` is not intended to mean:

- model vendor
- model family
- capability tier
- pricing category
- route purpose

Those are separate concerns and should be modeled separately.

## Supported Modes

### `openai-completions`

`openai-completions` represents the OpenAI-style chat completions dialect.

Typical characteristics:

- endpoint usually resembles `.../chat/completions`
- request bodies typically use a top-level `messages` array
- system instructions are commonly represented as a `system` message inside `messages`
- auth commonly uses `Authorization: Bearer ...`
- responses commonly use `choices`
- streaming commonly uses OpenAI-style chat completion chunks

Illustrative request:

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "system", "content": "Be concise." },
    { "role": "user", "content": "Summarize this document." }
  ],
  "stream": false
}
```

### `anthropic-messages`

`anthropic-messages` represents the Anthropic Messages dialect.

Typical characteristics:

- endpoint usually resembles `.../messages`
- request bodies use Anthropic Messages semantics
- system instructions are commonly represented in a top-level `system` field
- auth commonly uses `x-api-key`
- many integrations also require `anthropic-version`
- responses use an Anthropic-style envelope
- streaming uses Anthropic SSE event types such as `message_start` and `content_block_delta`

Illustrative request:

```json
{
  "model": "claude-sonnet-4-6",
  "system": "Be concise.",
  "messages": [
    { "role": "user", "content": "Summarize this document." }
  ],
  "max_tokens": 256,
  "stream": false
}
```

## API Mode Versus Model Vendor

This distinction is mandatory.

Model vendor and API mode are not the same concept.

Examples:

- a Claude-family model accessed through Anthropic-native infrastructure is commonly `anthropic-messages`
- a Claude-family model exposed through an OpenAI-compatible gateway may still be `openai-completions`
- an OpenRouter-backed route may expose different model families through different API modes

Therefore:

- a Claude model is not automatically an Anthropic-mode route
- an OpenAI-labeled model is not automatically using OpenAI-owned infrastructure
- the route or provider `api_mode` is the authoritative signal for wire behavior

## Where API Modes Apply

### Providers

Providers declare the upstream API mode they speak.

That determines:

- how Switchmaxxer constructs outbound requests
- which auth headers it applies
- how it parses upstream responses
- how it handles upstream streaming

### Routes

Routes inherit practical upstream behavior from their selected provider and surface that behavior in the read model.

For operators, this means `api_mode` is one of the key route and provider fields to inspect when debugging behavior, because it tells you which dialect is actually in play.

### Listeners

Switchmaxxer exposes distinct client-facing listener surfaces for different dialects.

Examples:

- an OpenAI-style listener surface
- an Anthropic-style listener surface

The client-facing listener mode and the upstream provider mode may match or differ.

## Translation Model

Switchmaxxer must reason about both sides of the request path:

1. the API mode the client is using
2. the API mode the upstream provider expects

Those values may match or differ.

Examples:

- OpenAI listener -> OpenAI upstream: near pass-through
- Anthropic listener -> Anthropic upstream: near pass-through
- OpenAI listener -> Anthropic upstream: translation required
- Anthropic listener -> OpenAI upstream: translation required

This is one of the main reasons `api_mode` is operationally important. It tells Switchmaxxer whether a path is primarily routing traffic or actively translating it.

## Translation Boundary Notes

Not every translated field is fully re-validated by Switchmaxxer before it is
sent upstream.

Current important example:

- on the `OpenAI listener -> Anthropic upstream` path, fields such as
  `temperature`, `top_p`, and `metadata` are forwarded through to the
  Anthropic request body when present
- OpenAI `tools`, `tool_choice`, assistant `tool_calls`, and client
  `role: "tool"` results are translated into Anthropic tool definitions,
  tool-choice objects, `tool_use` blocks, and `tool_result` blocks
- these fields are preserved or translated as part of the translation boundary
  rather than being exhaustively type-validated by Switchmaxxer first
- invalid values for those fields can therefore surface as upstream Anthropic
  `400` responses rather than as local Switchmaxxer validation errors

Operational implication:

- when debugging an upstream `400` on an OpenAI-to-Anthropic translation path,
  inspect passthrough request fields as well as route/provider config
- for one local non-streaming reproduction, `smx invoke --inspect` shows the
  client request, proxied provider request, upstream provider response, and
  final client response side by side so operators can see the actual translated
  protocol shapes

## Message-Format Differences

Although API mode is broader than message format, message-body differences remain one of the most practical ways to explain the modes.

The most important request-body differences are:

- `openai-completions` commonly places system instructions inside the `messages` array as a `system` message
- `anthropic-messages` commonly places system instructions in a separate top-level `system` field
- `openai-completions` uses OpenAI chat-completions conventions for content structure
- `anthropic-messages` uses Anthropic Messages conventions, including different content-block and streaming semantics

In practice:

- if a caller sends OpenAI-style chat-completions payloads, it is speaking `openai-completions`
- if a caller sends Anthropic Messages payloads, it is speaking `anthropic-messages`

## Contract Differences By Mode

### Endpoint Shape

- `openai-completions` commonly means `POST /v1/chat/completions`
- `anthropic-messages` commonly means `POST /v1/messages`

### System Prompt Placement

- `openai-completions`: commonly in `messages`
- `anthropic-messages`: commonly in top-level `system`

### Auth Shape

- `openai-completions`: commonly `Authorization: Bearer ...`
- `anthropic-messages`: commonly `x-api-key`

### Response Shape

- `openai-completions`: commonly `choices`
- `anthropic-messages`: different response envelope and content organization

### Streaming Shape

- `openai-completions`: OpenAI-style chat completion chunk stream
- `anthropic-messages`: Anthropic SSE event stream

Standards note:

- Server-Sent Events (SSE) are specified by the WHATWG HTML Living Standard
  through the `EventSource` / server-sent events definition
- `text/event-stream` uses an event grammar that permits LF, CRLF, or CR line
  endings
- streaming adapters must therefore not assume LF-only framing when parsing
  Anthropic-style SSE streams

## Invariants

The following invariants should hold across the system:

- `api_mode` must describe a wire/API contract, not a vendor identity
- route and provider inspection surfaces must expose `api_mode` clearly
- translation logic must be keyed off client-facing mode and upstream mode, not model-vendor assumptions
- documentation, CLI output, MCP output, and observability terminology should use `api_mode` as the canonical term

## Operational Implications

Operators should use API mode to reason about:

- which listener contract the client is speaking
- which upstream contract the provider expects
- whether translation is happening
- whether auth and header behavior are consistent with the expected mode
- whether an unexpected failure is a routing problem or a dialect mismatch

## URL Shape And Client Behavior

Some clients infer API mode not only from explicit configuration but also from base URL conventions.

For example:

- a base URL ending in `/anthropic` may lead a client to speak Anthropic Messages
- a plain base URL may lead the same client to use an OpenAI-style dialect

This means API mode can be chosen by the client before Switchmaxxer even receives the request.

## Recommended Mental Model

Every request path should be understood as having at least two API-mode values:

- `client_api_mode`
- `upstream_api_mode`

Switchmaxxer’s responsibility is to either:

- preserve the same dialect end to end, or
- translate cleanly between the two

That is why API mode is a first-class concept across config, runtime behavior, CLI surfaces, MCP surfaces, and observability fields.
