# Switchmaxxer CLI Design White Paper

> A white paper on the design posture, operating principles, and command-line
> philosophy of the Switchmaxxer CLI.

This document is broader than a command reference or implementation tech spec.
It explains the design principles that shape the CLI, connects those
principles to the Switchmaxxer command surface in source, and gives architectural
guidance for future CLI work in the repo.

Use it when:

- evaluating whether the Switchmaxxer CLI follows sound command-line design
  principles
- deciding how new flags, stdio behavior, or machine-readable output should
  work
- checking long-horizon CLI quality goals against a broader standard
- understanding the architectural stance behind the CLI rather than just the
  literal command inventory

For the Switchmaxxer command surface, prefer:

- [README.md](../../../README.md)
- [tech-spec-for-cli-surface.md](tech-spec-for-cli-surface.md)
- [product-architecture-spec.md](../../architecture/product-architecture-spec.md)
- [switchmaxxer-logging-reference.md](../observability/switchmaxxer-logging-reference.md)

Switchmaxxer note:

- the repo centers runtime lifecycle on the `switchmaxxer gateway ...` command family
- service-log retrieval flows through `switchmaxxer gateway logs show|tail`
- the observability posture includes both:
  - logs-first debugging
  - a real persisted observability subsystem through `switchmaxxer trace ...` and `switchmaxxer bench ...`

---

## Table of Contents

1. [Foundational Philosophy](#1-foundational-philosophy)
2. [Command Structure & Syntax](#2-command-structure-syntax)
3. [Universal Standard Flags](#3-universal-standard-flags)
4. [Input / Output & Stdio Contracts](#4-input-output-stdio-contracts)
5. [Exit Codes](#5-exit-codes)
6. [Configuration Hierarchy](#6-configuration-hierarchy)
7. [Error Handling & Diagnostics](#7-error-handling-diagnostics)
8. [Logging & Verbosity](#8-logging-verbosity)
9. [Interactivity & TTY Detection](#9-interactivity-tty-detection)
10. [Structured Output & Machine-Readable Mode](#10-structured-output-machine-readable-mode)
11. [MCP & Agent Integration](#11-mcp-agent-integration)
12. [Authentication & Secrets](#12-authentication-secrets)
13. [Plugins & Extensibility](#13-plugins-extensibility)
14. [Help & Documentation](#14-help-documentation)
15. [Contract Stability](#15-contract-stability)
16. [Shell Completion](#16-shell-completion)
17. [Performance & Startup Time](#17-performance-startup-time)
18. [Security Considerations](#18-security-considerations)
19. [Testing Your CLI](#19-testing-your-cli)
20. [Naming Conventions & Command Taxonomy](#20-naming-conventions-command-taxonomy)
21. [Switchmaxxer Implementation Notes](#21-switchmaxxer-implementation-notes)

---

## 1. Foundational Philosophy

The Unix philosophy, articulated by Doug McIlroy, has three core rules that remain relevant:

1. **Do one thing well.** Each command (or subcommand) should have a single, well-defined purpose.
2. **Write programs that work together.** Assume your output will be piped into another program.
3. **Write programs that handle text streams.** Text is the universal interface.

Modern CLIs extend this with additional principles:

- **Predictability over cleverness.** Users should be able to guess what a flag does before reading the docs.
- **Fail loudly and precisely.** Ambiguous failures cost more time than verbose errors.
- **Compose at every layer.** Support piping, redirection, scripting, environment variables, and agent invocation without special cases.
- **Respect the human and the machine equally.** A CLI should be pleasant for humans in a terminal and reliable for machines in a pipeline.

---

## 2. Command Structure & Syntax

### 2.1 Anatomy of a Command

```
<binary> [global flags] <verb> [subcommand] [flags] [arguments]
```

**Examples:**

```bash
switchmaxxer gateway run --config ./config.json
switchmaxxer trace list --json
switchmaxxer mcp serve --config ./config.json
```

### 2.2 Verbs (Top-Level Subcommands)

Use common, predictable verbs. In Switchmaxxer, the operator vocabulary centers
on these verbs and command families:

| Verb | Purpose |
|---|---|
| `list` | Read one or many resources |
| `show` / `explain` | Read one resource or explain a routing decision |
| `create` | Create a resource |
| `update` / `set` | Modify an existing resource |
| `delete` / `clear` | Remove a resource or clear a setting |
| `run` / `start` / `stop` / `restart` / `reload` | Execute or manage a runtime process |
| `status` | Report runtime or control-plane state |
| `logs` | Stream or retrieve log output |
| `config` | Read/write configuration |
| `trace` / `bench` / `test` / `invoke` | Operator inspection and execution surfaces |
| `help` | Print help |

Avoid inventing verbs when a standard one suffices.

### 2.3 Flags

Use GNU-style long flags as the primary interface.

```bash
# Long form (required for all flags)
switchmaxxer gateway run --config ./config.json --log-level debug

# Short form (optional, for common flags only)
switchmaxxer trace list --json
```

**Flag naming rules:**

- Use `kebab-case` for multi-word flags: `--log-level`, `--batch-size`, `--older-than`
- Prefer explicit long flags over compressed aliases for operator-facing flows
- Use flag names that match the source contract exactly; avoid undocumented synonyms

### 2.4 Arguments vs. Flags

Use **positional arguments** for primary nouns that are required and unambiguous:

```bash
switchmaxxer routes show gpt-4o-mini
switchmaxxer trace show trc_123
```

Use **flags** for options, modifiers, and anything optional or named:

```bash
switchmaxxer gateway run --config ./config.json --bind-host 127.0.0.1
```

When in doubt, prefer flags — they are self-documenting in scripts and logs.

---

## 3. Universal Standard Flags

Cross-cutting flags should stay sparse and predictable. In Switchmaxxer, the
important portable behaviors are help, machine-readable output where
supported, and explicit config-path selection on surfaces that load config.

| Flag | Short | Type | Description |
|---|---|---|---|
| `--help` | `-h` | bool | Print help for the requested command/subcommand and exit 0 |
| `--json` | | bool | Output results as JSON on supported control-plane commands |
| `--config` | `-c` | path | Override config file path on config-aware commands |

Switchmaxxer note:

- not every command supports the same flag set
- `--json` is a documented contract only on the command families that expose
  machine-readable output
- `--config` is the important portability flag because the repo is explicitly
  config-driven

## 4. Input / Output & Stdio Contracts

### 4.1 The Three Streams

| Stream | fd | Usage |
|---|---|---|
| `stdin` | 0 | Data input on commands that explicitly support stdin-backed input. |
| `stdout` | 1 | **Primary output only.** Structured data, results, content to be piped downstream. |
| `stderr` | 2 | **All human-readable output.** Progress, warnings, errors, prompts, spinners. |

**Critical rule:** Never mix diagnostic output with data output on stdout. Anything that is not machine-consumable data belongs on stderr.

### 4.2 Pipe-Friendly Design

```bash
# These must all work correctly
switchmaxxer trace list --json | jq '.data.items[].trace_id'
switchmaxxer gateway logs show --format json | jq '.[].event'
switchmaxxer bench list --json | jq '.data.runs[].run_id'
switchmaxxer gateway logs tail --format json | jq -c '.'
```

Your command must:

- Accept `stdin` as a data source when appropriate (detect via `!isatty(0)`)
- Emit clean, newline-delimited records to stdout when piping
- Not add trailing interactive prompts or spinners to stdout in pipe mode
- Exit immediately and cleanly when a downstream pipe closes (handle `SIGPIPE`)

### 4.3 Reading from `-`

When a command documents stdin-backed input, it should treat stdin as a first-class source:

```bash
cat ./switchmaxxer-backup.json | switchmaxxer config import --stdin --backup --json
switchmaxxer config import --json-input ./switchmaxxer-backup.json --dry-run
```

---

## 5. Exit Codes

Exit codes are the return type of a CLI. They must be consistent and documented.

Switchmaxxer CLI contract:

- `0`: success
- `1`: runtime or operational failure
- `2`: usage error, invalid flags, or missing required arguments

Entity-state, config, and transport distinctions belong in structured `error.code` payloads rather than custom process exit codes. Keep the shell-facing contract small, stable, and documented in root `switchmaxxer --help`.

**Never** exit 0 on failure, even if the error is non-fatal. Downstream scripts and agents rely on exit codes for control flow.

---

## 6. Configuration Hierarchy

Configuration should be resolved in the following order, from lowest to highest precedence:

```
1. Compiled defaults (lowest)
2. Config file                  (explicit --config path, or local default when supported)
3. Environment variables        (SWITCHMAXXER_*)
4. Command-line flags           (highest)
```

### 6.1 Config File Format

Switchmaxxer is JSON-configured. The design guidance in this repository should
assume JSON as the canonical config format, not YAML.

```json
{
  "gateway": {
    "bind_host": "127.0.0.1",
    "port": 4080
  },
  "service_providers": {
    "openai_direct": {
      "endpoint": "https://api.openai.com/v1",
      "api_mode": "openai-completions",
      "api_key_env": "SWITCHMAXXER_OPENAI_API_KEY"
    }
  }
}
```

### 6.2 Environment Variables

Important runtime and credential settings should be overridable via environment
variables where the codebase supports them:

```bash
SWITCHMAXXER_LOG_LEVEL=debug
SWITCHMAXXER_OPENAI_API_KEY=...
SWITCHMAXXER_ANTHROPIC_API_KEY=...
```

Document the important env var mapping in docs and help output, especially for:

- provider credentials
- gateway log level
- inbound gateway auth when configured through env-backed fields

### 6.3 `config` Subcommand

Switchmaxxer exposes a `config` family for configuration inspection and import:

```bash
switchmaxxer config validate --json
switchmaxxer config show --json
switchmaxxer config schema --json
switchmaxxer config import --json-input ./switchmaxxer-backup.json --dry-run
switchmaxxer routes show route_id --json
```

---

## 7. Error Handling & Diagnostics

### 7.1 Error Message Format

All error messages go to **stderr**. Format:

```
Error: <short description>
  Cause: <root cause if known>
  Hint:  <actionable suggestion>

Run '<relevant switchmaxxer command> --help' for usage.
```

Example:

```
Error: failed to reach upstream provider
  Cause: connection refused
  Hint:  check provider endpoint and credential environment variables.

Run 'switchmaxxer gateway run --help' for usage.
```

In `--json` mode, errors must also be JSON on stderr:

```json
{
  "error": true,
  "code": "upstream_connection_refused",
  "message": "failed to reach upstream provider",
  "cause": "connection refused",
  "hint": "check provider endpoint and credential environment variables"
}
```

### 7.2 Validation Errors

For commands that accept multiple inputs, report all validation errors at once — do not fail on the first one:

```
Error: 3 validation errors in config mutation
  [1] endpoint: required field is missing
  [2] api_mode: must be one of the supported listener dialects
  [3] service_provider: referenced provider does not exist
```

---

## 8. Logging & Verbosity

### 8.1 Log Levels

Support standard log levels, controlled by explicit runtime flags and
environment where supported:

| Level | Flag | When to use |
|---|---|---|
| `error` | (always) | Failures that prevent completion |
| `warn` | (always) | Recoverable issues, deprecations |
| `info` | default | Normal operational messages |
| `debug` | `switchmaxxer gateway run --log-level debug` | Internal state, API calls, timing |

Switchmaxxer implementation note:

- the runtime supports `error`, `warn`, `info`, and `debug`
- the environment variable is `SWITCHMAXXER_LOG_LEVEL`
- precedence is CLI flag, then environment, then config, then default
- the explicit runtime flag is `switchmaxxer gateway run --log-level <level>`

### 8.2 Log Output Format

In human mode, use structured plaintext with level prefixes:

```
[INFO]  gateway starting on 127.0.0.1:4080
[WARN]  inbound auth disabled
[DEBUG] upstream request route=gpt-4o-mini provider=openai_direct
[ERROR] upstream connection refused
```

In `--json` mode, emit newline-delimited JSON log objects to stderr:

```json
{"level":"info","ts":"2026-04-14T10:23:01Z","msg":"gateway starting","host":"127.0.0.1","port":4080}
{"level":"error","ts":"2026-04-14T10:23:09Z","msg":"upstream request failed","code":"upstream_connection_refused"}
```

---

## 9. Interactivity & TTY Detection

### 9.1 TTY Detection

A CLI must detect whether it is connected to a terminal and adjust behavior accordingly.

```
isatty(stdout) = true  → human mode: colors, spinners, progress bars, prompts
isatty(stdout) = false → pipe/script mode: plain text, no spinners, no prompts
```

**Never** block a pipeline waiting for user input unless `stdin` is also a TTY.

### 9.2 Interactive Prompts

Switchmaxxer's main operator flows are designed to stay explicit and
script-friendly. The repo does not rely on interactive confirmation prompts as
part of the normal control-plane contract.

### 9.3 Progress Indicators

The repo does not rely on spinners or progress bars in the documented CLI
contract. If such indicators are ever added, they should write to **stderr**,
never stdout.

---

## 10. Structured Output & Machine-Readable Mode

### 10.1 Output Formats

Switchmaxxer's important machine-readable format is JSON.

| Format | Description |
|---|---|
| `text` | Default human-readable output |
| `json` | Full JSON object or array |
| `jsonl` / NDJSON | Stream-oriented records where a command emits a record stream |

### 10.2 JSON Output Contract

When `--json` is set:

- All stdout is valid JSON (or newline-delimited JSON for streams)
- The schema must be stable and documented
- Success responses use a consistent envelope:

```json
{
  "ok": true,
  "data": { ... },
  "meta": {
    "request_id": "req_abc123",
    "duration_ms": 142
  }
}
```

- Error responses use a consistent envelope (on stderr):

```json
{
  "ok": false,
  "error": {
    "code": "not_found",
    "message": "service \"my-svc\" not found",
    "request_id": "req_abc123"
  }
}
```

### 10.3 Streaming Output

For long-running commands that produce output over time (logs, watch, follow), emit newline-delimited JSON records:

```bash
switchmaxxer gateway logs tail --format json
```

```json
{"ts":"2026-04-14T10:23:01Z","level":"info","msg":"Server started on :8080"}
{"ts":"2026-04-14T10:23:02Z","level":"info","msg":"Received request GET /health"}
```

---

## 11. MCP & Agent Integration

Switchmaxxer already has a real MCP surface. CLI design has to stay aligned with
that contract.

### 11.1 Design for Agent Invocation

Agents cannot see spinners, cannot click prompts, and parse stdout. Design accordingly:

- `--json` must always produce complete, parseable output
- Avoid stdout/stderr interleaving that corrupts JSON parsing
- Long-running operations should exit cleanly and avoid polluting JSON output

### 11.2 MCP Discovery Surface

Switchmaxxer exposes MCP capabilities through:

```bash
switchmaxxer mcp serve --config ./config.json
```

Clients discover capabilities through standard MCP methods such as:

- `initialize`
- `tools/list`
- `tools/call`

The detailed tool catalog belongs in the MCP tech spec, not in ad hoc CLI
manifest output.

### 11.3 Idempotency

All mutating commands should be idempotent where possible. Agents may retry on failure. Document which commands are idempotent.

### 11.4 Agent-Safe Defaults

Switchmaxxer does not define a separate `--agent` mode. The machine-readable CLI
and MCP contracts are the agent-facing surface.

---

## 12. Authentication & Secrets

### 12.1 Secret Sources

Switchmaxxer's important secret inputs are:

```
1. Environment variables referenced by config (`api_key_env`, inbound auth env vars)
2. Inline config secrets where explicitly allowed
3. CLI mutation flows that write provider auth into config
```

Environment variables are the preferred path for provider credentials and other
machine-managed secrets.

### 12.2 Secret Storage

Switchmaxxer does not expose `login`, `logout`, or `whoami` flows.

Its secret-handling posture is instead:

- prefer env-var-backed credentials
- redact provider secrets in read models and MCP/CLI output
- treat config-file permissions as sensitive when inline secrets exist

### 12.3 Secret Hygiene

- Never log or print secrets — not even at the highest debug verbosity
- Redact secrets in error output: `Bearer sk-••••••••`
- Reject config files with group or world access before reading them: `chmod 600`
- Accept secrets via environment variables; never require them as positional arguments (they appear in process lists and shell history)

---

## 13. Plugins & Extensibility

Switchmaxxer does not implement a plugin system in source.

If extensibility is introduced later, it should be treated as a separate
architecture decision rather than assumed into the CLI contract.

---

## 14. Help & Documentation

### 14.1 Help Output Structure

`--help` output for every command must include:

```
Usage:
  switchmaxxer gateway run [flags]

Description:
  Run the Switchmaxxer gateway in the foreground.

Flags:
      --config string        Config file path
      --host string          Listener bind host
      --port int             Listener port
      --log-level string     Log level

Global Flags:
  -h, --help                 Show help

Environment Variables:
  SWITCHMAXXER_LOG_LEVEL       Default runtime log level
  SWITCHMAXXER_OPENAI_API_KEY  Provider credential when referenced by config

Examples:
  Run the gateway:
    switchmaxxer gateway run --config ./config.json

  Validate config first:
    switchmaxxer config validate --config ./config.json --json

See Also:
  switchmaxxer gateway status, switchmaxxer gateway health, switchmaxxer gateway logs tail

Documentation:
  docs/subsystems/cli/tech-spec-for-cli-surface.md
```

### 14.2 Man Pages

If man pages are ever added, they should be generated from the same source of
truth as CLI help and docs.

### 14.3 Error Messages Link to Docs

When possible, include a link to documentation in error output:

```
Error: invalid api_mode "anthropic"
  Hint: valid values include openai-completions and anthropic-messages
  Docs: docs/subsystems/config/config-reference.md
```

---

## 15. Contract Stability

### 15.1 Keep The Shell Contract Small And Stable

For Switchmaxxer, the important operator contract is:

- stable command names
- stable required arguments and flag meanings
- stable exit codes
- stable JSON envelope shape in `--json` mode

When the command surface grows, prefer additive changes over silent renames.

### 15.2 Switchmaxxer Rule

The repo treats these as stable operator expectations:

- `0` success
- `1` runtime or operational failure
- `2` usage failure
- machine-readable results stay inside the documented envelope shape
- new fields may appear in JSON payloads, but existing documented fields should keep their meaning

---

## 16. Shell Completion

Switchmaxxer does not expose a shell-completion command.

If shell completion is added later, it should derive command and flag shape
from the same registry that drives help and dispatch.

---

## 17. Performance & Startup Time

- **Target startup time: < 100ms** for help and lightweight inspection commands. Users run these constantly.
- **Lazy-load expensive operations.** Don't initialize API clients, load full config, or validate credentials until a command actually needs them.
- **Parallelize independent operations** where possible (e.g., fetching multiple resources).
- Report duration in logs or `--json` output so users can identify slow operations.

---

## 18. Security Considerations

- **Validate all inputs.** Treat all positional arguments and flag values as untrusted. Be especially careful with file paths (directory traversal).
- **Avoid shell injection.** Never construct shell commands via string interpolation. Use exec-family calls with argument arrays.
- **Check file permissions** before reading config or credential files. Reject group- or world-accessible config files.
- **Verify TLS certificates** by default in upstream transport code.
- **Audit sensitive operations.** For config mutation and gateway lifecycle
  operations, rely on the runtime log surface and persisted observability where
  appropriate instead of inventing a second unrelated audit file format.
- **Never execute downloaded code** without a signature check.

---

## 19. Testing Your CLI

### 19.1 Test Categories

| Category | What to test |
|---|---|
| Unit tests | Flag parsing, config resolution, output formatting |
| Integration tests | Subcommand execution against a mock API |
| Contract tests | JSON output schema stability across documented envelopes |
| End-to-end tests | Full invocation from a subprocess; check exit codes, stdout, stderr |

### 19.2 Testing Patterns

Test your CLI by invoking it as a subprocess, not by calling internal functions. This catches regressions in the user-facing interface:

```js
import { execFileSync } from "node:child_process";

const out = execFileSync("./switchmaxxer", ["trace", "stats", "--json"], {
  encoding: "utf8",
});
const result = JSON.parse(out);

if (result.ok !== true) {
  throw new Error("expected successful JSON envelope");
}
```

### 19.3 Golden File Testing

For commands with complex output, use golden files — commit expected output and diff against it on every test run. Gate updates behind a `--update-golden` flag.

---

## 20. Naming Conventions & Command Taxonomy

### 20.1 Binary Name

- The canonical binary name is `switchmaxxer`
- `smx` is the official short operator alias for `switchmaxxer`
- Register supporting launchers and docs under the same naming model

### 20.2 Subcommand Naming

- Use lowercase, hyphen-separated nouns and verbs where a single token is needed
- Group related commands under a noun or family: `switchmaxxer gateway start`, `switchmaxxer routes show`
- Prefer `list` over `ls`; prefer `delete` over `rm`; prefer explicit family verbs over compressed aliases

### 20.3 Flag Naming

- `kebab-case` for all multi-word flags
- Consistent across all subcommands: if `--config` is used in one place, do not silently rename it elsewhere
- Flag names should match the documented source contract exactly

### 20.4 Resource Naming

- Use singular nouns for resources in commands when naming leaf resources directly
- Accept both singular and plural where it reads naturally

---

## 21. Switchmaxxer Implementation Notes

This section records how the Switchmaxxer repo maps the general CLI guidance above into concrete behavior.

### 21.1 Runtime command family

Switchmaxxer centers runtime lifecycle and inspection on:

- `switchmaxxer gateway run`
- `switchmaxxer gateway start`
- `switchmaxxer gateway stop`
- `switchmaxxer gateway restart`
- `switchmaxxer gateway reload`
- `switchmaxxer gateway status`
- `switchmaxxer gateway health`
- `switchmaxxer gateway logs show`
- `switchmaxxer gateway logs tail`

That family should be treated as the operator contract.

### 21.2 Observability posture

Switchmaxxer uses both runtime logs and a persisted observability store.

That means:

- `switchmaxxer gateway logs show|tail` remains the first stop for live runtime inspection
- request-path logs carry `request_id`
- proxied responses expose `x-switchmaxxer-request-id`
- the persisted store is available through `switchmaxxer trace ...` and `switchmaxxer bench ...`
- the debug lifecycle uses:
  - `debug_ingress`
  - `debug_route_resolution`
  - `debug_upstream_request`
  - `debug_upstream_retry`
  - `debug_response_path`
  - `debug_client_response`
  - `debug_error_context`

### 21.3 Trace surface

The general CLI guidance in this document allows for trace-oriented commands and flags. In the Switchmaxxer repo, that should be interpreted conservatively:

- `switchmaxxer trace` is a supported CLI surface backed by the local observability store
- trace inspection should be treated as the request and observation inspection surface
- any additional trace-oriented flags should build on that observability-store-backed contract rather than assuming a separate trace subsystem

### 21.4 Command Registry & Declarative Semantics

The Switchmaxxer CLI is organized around a declarative command-registry model composed in [src/app-cli.ts](../../../src/app-cli.ts) and [src/subsystems/cli/app-registry.ts](../../../src/subsystems/cli/app-registry.ts), with [src/index.ts](../../../src/index.ts) acting as the thin process-facing entrypoint. The registry is the source of truth for:

- top-level command discovery
- family and subcommand dispatch
- top-level help and most family help
- positional-argument requirements for many leaf commands
- reserved or unsupported command surfaces
- the default no-args entry behavior

The three top-level registry layers are:

- `CLI_COMMAND_REGISTRY`
  - the primary operator surface
  - contains the user-facing command families and one-off command surfaces
- `GLOBAL_META_COMMAND_REGISTRY`
  - the synthetic global/meta family
  - owns top-level help and meta-command behavior
- `DEFAULT_ENTRY_COMMAND_REGISTRY`
  - the synthetic default-entry family
  - models bare `switchmaxxer` as the declarative default entrypoint for `gateway run`

The CLI resolves commands through ordered registry layers rather than treating
the raw `argv` cascade as the primary architectural contract. `runCli(...)`
resolves commands in these layers:

1. `CLI_COMMAND_REGISTRY`
2. `GLOBAL_META_COMMAND_REGISTRY`
3. `DEFAULT_ENTRY_COMMAND_REGISTRY`
4. fallback unknown-command / unknown-flag handling

That is the command-registry model in the repo.

### 21.5 Command Families

The major operator families in `CLI_COMMAND_REGISTRY` are:

- `gateway`
  - lifecycle and runtime inspection
  - subcommands:
    - `run`
    - `start`
    - `stop`
    - `restart`
    - `enable`
    - `disable`
    - `status`
    - `health`
    - `reload`
    - `runtime config`
    - `logs tail`
    - `logs show`
- `config`
  - config inspection and mutation
  - subcommands:
    - `validate`
    - `show`
    - `schema`
    - `import`
    - `export`
    - `set`
- `models`
  - canonical model management
  - subcommands:
    - `list`
    - `show`
    - `create`
    - `update`
    - `delete`
- `providers`
  - service-provider management
  - subcommands:
    - `list`
    - `show`
    - `create`
    - `update`
    - `delete`
    - `set-key`
    - `clear-key`
    - `set-key-env`
- `routes`
  - route management and route explanation
  - supports optional per-route `timeout_ms` overrides over the global `timeout_ms` default
  - subcommands:
    - `list`
    - `show`
    - `create`
    - `update`
    - `delete`
    - `explain`
- `trace`
  - observability-store inspection and maintenance
  - subcommands:
    - `list`
    - `stats`
    - `observations`
    - `show`
    - `verify`
    - `repair`
- `ledger`
  - Control Plane Audit Ledger inspection
  - subcommands:
    - `list`
    - `show`

The smaller but still registry-backed families and one-off operational surfaces are:

- `bench`
  - default run surface plus:
    - `list`
    - `show`
- `tool`
  - built-in operator and developer utility surface
  - subcommands:
    - `date`
    - `uptime`
    - `random`
- `optimize`
  - persisted cost and latency route recommendation surface
  - provider apply/restore can change a target route's `service_provider` to
    the persisted winner's provider and restore it later
  - provider apply/restore write managed pre-mutation catalog snapshots and can
    run CLI post-action reload/verification checks
  - MCP tools match persisted cost/latency objectives and provider
    apply/restore mutation behavior
  - subcommands:
    - `list`
    - `show`
    - `apply`
    - `restore`
    - `prune`
    - `delete`
    - `clear`
- `mcp`
  - MCP server surface
  - subcommands:
    - `serve`
- `test`
  - route-test surface
  - no named subcommands; bare `switchmaxxer test ...` is the family default action
- `invoke`
  - one-off direct invocation surface
  - top-level leaf command rather than a nested family

### 21.6 Declarative Command Contract Model

The declarative model is intentionally pragmatic rather than fully abstract.

Registry entries describe command shape with fields such as:

- `name`
- `summary`
- `usageLines`
- `exampleLines`
- `match`
- `run`
- `positionals`
- `unsupportedMessage`
- nested `commands` for command families
- `missingSubcommandMessage` for nested family nodes

Two helper patterns are especially important:

- `createCliCommandRegistration(...)`
  - builds declarative leaf commands
  - especially useful when a command has required positional arguments or an explicitly unsupported/reserved state
- `createCliCommandFamilyRegistration(...)`
  - builds declarative nested family nodes such as:
    - `gateway runtime`
    - `gateway logs`

At the semantics layer, CLI contract failures are modeled through typed errors rather than string matching:

- `CliUsageError`
  - for usage failures, invalid input fields, conflicting modes, missing required fields, and similar command-contract problems
- `CliMutationError`
  - for entity-state and config-mutation failures such as:
    - already exists
    - not found
    - invalid stored object shape
    - unknown referenced model or provider

In practice, the declarative model means:

- command discovery is registry-backed
- help generation is largely registry-backed
- many required positionals and unsupported surfaces are registry-backed
- many usage and mutation failures now flow through typed command-semantics paths
- the remaining imperative pockets in the CLI are mostly true runtime, config, I/O, and postcondition invariants rather than ad hoc command-shape logic

---

## Appendix A: Quick Reference Checklist

Use this checklist when auditing a CLI against the Switchmaxxer design posture.

**Flags & Structure**
- [ ] `--help` is implemented consistently
- [ ] `--json` exists on documented machine-readable surfaces
- [ ] `--config` exists on config-aware surfaces
- [ ] All flags use `kebab-case`
- [ ] No flag conflicts with universal conventions

**I/O**
- [ ] Data output goes to stdout; diagnostics go to stderr
- [ ] Accepts stdin on commands that explicitly document stdin-backed input
- [ ] Handles `SIGPIPE` cleanly
- [ ] Does not block on prompts when not connected to a TTY

**Exit Codes**
- [ ] Exit 0 only on success
- [ ] Exit codes are documented
- [ ] Exits non-zero on all failures, including partial failures

**Machine-Readability**
- [ ] `--json` produces valid, schema-stable JSON on stdout
- [ ] Errors in `--json` mode are JSON on stderr
- [ ] CLI machine-readable envelopes stay aligned with the MCP tool contract

**Configuration**
- [ ] Config file, env vars, and flags are supported with correct precedence
- [ ] Important runtime and credential settings are overridable via env vars
- [ ] `switchmaxxer config` validation and inspection flows are available

**Security**
- [ ] Secrets are never logged or printed
- [ ] TLS verification is on by default
- [ ] File path inputs are validated against traversal

**UX**
- [ ] Help output and command discovery stay source-synchronous and easy to scan
- [ ] Startup time for `--help` and lightweight inspection commands is < 100ms
- [ ] Help output includes examples

---
