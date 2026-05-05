# Switchmaxxer: The AI Gateway Your Agents Can Actually Operate

**An open-source LLM reverse proxy where the CLI, MCP, and observability surfaces are first-class peers — designed from day one to be operated by agents, not just by humans.**

---

## The standard stuff, done right

Like every serious AI Gateway, Switchmaxxer routes traffic between client apps and a plethora of LLMs and their providers. You define **service providers**, **routes**, and **models** in `catalog.json` — route names like `claude-sonnet-4-6`, `openrouter-claude-sonnet-4-6`, and `gpt-4o-mini` — and clients point their SDKs at one local endpoint instead of hard-coding provider logic into every app. Runtime, security, MCP, and observability settings live in `config.json` next to the catalog.

It speaks both LLM dialects natively on the same port: **OpenAI-compatible chat completions** at `/v1/chat/completions` and **Anthropic-compatible messages** at `/anthropic/v1/messages`. Per-route `api_mode` controls the outbound dialect, and translation between dialects happens on the hot path where it has to — that's table stakes for any modern gateway.

That's where Switchmaxxer's resemblance to the rest of the market ends.

## What sets Switchmaxxer apart

### 1. Agents can finally optimize their own routes

Switchmaxxer was built from the ground up with **native CLI / MCP / observability alignment**. From day one the design has been simple:

- **The CLI is the hands** — what operators use to drive the gateway directly.
- **The MCP surface is the gloves** — the same hands, fitted for agents.
- **Observability is the eyes** — what both surfaces look through.

Every operator capability is an agent capability. Not a subset. Not a sandbox. The same surface.

That includes the parts of an AI Gateway that are usually keep behind a human-only console:

- **`trace`** — every request, every observation, queryable.
- **`bench`** — run controlled benchmarks against any route, any path, any prompt.
- **`optimize`** — pick the cheapest or fastest route to a model, with the receipts to prove it.

When you have multiple routes pointing at the same model — say `claude-sonnet-4-6` direct from Anthropic and `openrouter-claude-sonnet-4-6` through OpenRouter — your agent can ask Switchmaxxer:

> *"Which of these is fastest right now?"*

Switchmaxxer runs a fresh, controlled benchmark across each candidate (no stale data, no mystery provenance), ranks them by median measured latency, persists the result for inspection, and tells the agent which route to use. The agent can apply the winner directly through the privileged MCP `optimize_apply` tool — it writes a pre-apply catalog snapshot first, so `optimize_restore` can roll back if something goes sideways.

Routine gateway upkeep — pruning old observations, inspecting health, reading runtime config, exploring traces, running benchmarks — is **MCP-exposed too**, with capability tiers (`read`, `mutation`, `privileged`) that you grant explicitly in `config.json`. Your agent doesn't just *use* Switchmaxxer. It *operates* Switchmaxxer, within the trust envelope you set.

### 2. Observability that stays off the hot path

Observability is never a tax on the speed. Switchmaxxer's observability subsystem is a **first-class peer** of the routing layer, not a hitchhiker on it.

It runs in-process, backed by Node 22's built-in `node:sqlite`, and stays **off the hot path**. The router routes. Observations land asynchronously through a queued worker. The same subsystem powers everything you need to actually operate a gateway:

- **logging** — structured logs from the long-running gateway, journald-backed when run as a `systemd --user` service, inspectable through `switchmaxxer gateway logs`
- **observations** — every meaningful event in a request's lifecycle, captured and queryable through `switchmaxxer trace observations`
- **tracing** — full request lifecycle reconstruction through `switchmaxxer trace list/show/stats/verify/repair`
- **benchmarking** — controlled measurement runs through `switchmaxxer bench`, persisted alongside live traffic with `bench list/show/prune/delete/clear`
- **optimization** — cost or latency route recommendations through `switchmaxxer optimize`, with persisted history and CLI/MCP `apply`/`restore` against catalog snapshots
- **audit** — every control-plane mutation written to a Control Plane Audit Ledger you can inspect with `switchmaxxer ledger list/show`

It's all one store, one query layer, one mental model. Your traces, your benchmarks, your optimization decisions, and your mutation audit trail live in the same place — and your agent can read all of it through MCP.

## Local-first, by design

Switchmaxxer runs on your machine. Loopback-bound by default (`bind_host: "127.0.0.1"`). Config and catalog validated before the gateway starts. Inbound auth required unless `allow_unauthenticated_gateway` is explicitly opted into on a loopback bind. Provider endpoints DNS-pinned and screened against private/loopback addresses unless `allow_private_endpoints` is opted in per provider. Provider keys resolved through env vars by default, with inline keys gated behind privileged surfaces and config files written `0o600`. Optional `systemd --user` integration for clean background operation. Your provider keys, your routes, your observability data — all local.

No vendor cloud. No telemetry exfiltration. No "managed control plane" between you and your routes.

## Who this is for

- **Agent builders** who need their agents to make routing decisions instead of having those decisions baked in.
- **App developers** who want one stable local LLM endpoint and the ability to swap providers without touching client code.
- **Operators** who want runtime visibility and config-driven routing — and want their AI assistants to handle the boring parts.
- **Anyone running local AI workflows** who needs one trusted gateway between their applications and the model providers.

## The pitch in one sentence

**Switchmaxxer is the AI Gateway that treats agents as operators, not just as traffic — with an observability layer powerful enough to make that operation worth doing.**

---

*Open source. Local-first. Built so your agents can finally see what they're doing.*