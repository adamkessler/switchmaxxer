# MCP CLI Contract Tech Spec

## Purpose

This document defines the shared machine-facing JSON contract that the
CLI and MCP surfaces expose.

It covers the JSON-capable config control surface plus the supported
observability surfaces. It does not claim that every CLI command is available
through MCP.

For the full MCP tool catalog, including every `mcp serve` tool name, input
shape, and return alignment, see
[tech-spec-for-mcp.md](../subsystems/mcp/tech-spec-for-mcp.md).

## Field Naming Policy

Switchmaxxer uses exactly two naming conventions:

- `snake_case` for every external serialized surface
- `camelCase` for all internal TypeScript and runtime code

External serialized surfaces include:

- persisted config files
- CLI JSON envelopes and machine-readable output
- MCP tool inputs, outputs, and schemas
- operator-facing docs and examples that describe external field names

Explicit exclusion:

- the proxy API surface is not part of the CLI/MCP JSON envelope contract
- proxy request and response bodies intentionally follow the compatibility rules
  documented in
  [tech-spec-for-proxy.md](../subsystems/proxy/tech-spec-for-proxy.md)

Internal runtime surfaces include:

- TypeScript types and interfaces used only inside the codebase
- function parameters and return values used only inside the codebase
- in-memory runtime objects after boundary normalization

Boundary rule:

- readers normalize external `snake_case` fields into internal `camelCase`
- writers translate internal `camelCase` fields back into external `snake_case`
- field-name translation belongs at boundary adapters, not ad hoc throughout the codebase

Current contract:

- external serialized field names use `snake_case`
- internal runtime field names use `camelCase`
- boundary adapters own the translation between those two surfaces

## Supported Commands

The MCP-facing contract covers these JSON-capable CLI surfaces:

- `switchmaxxer config validate --json`
- `switchmaxxer config show --json`
- `switchmaxxer config schema --json`
- `switchmaxxer models list --json`
- `switchmaxxer models show <model-id> --json`
- `switchmaxxer models create <model-id> --json`
- `switchmaxxer models update <model-id> --json`
- `switchmaxxer models delete <model-id> --json`
- `switchmaxxer providers list --json`
- `switchmaxxer providers show <provider-id> --json`
- `switchmaxxer providers create <provider-id> --json`
- `switchmaxxer providers update <provider-id> --json`
- `switchmaxxer providers delete <provider-id> --json`
- `switchmaxxer providers set-key <provider-id> --json`
- `switchmaxxer providers clear-key <provider-id> --json`
- `switchmaxxer providers set-key-env <provider-id> <env-var> --json`
- `switchmaxxer routes list --json`
- `switchmaxxer routes show <route-id> --json`
- `switchmaxxer routes explain <route-id> --json`
- `switchmaxxer routes create <route-id> --json`
- `switchmaxxer routes update <route-id> --json`
- `switchmaxxer routes delete <route-id> --json`
- `switchmaxxer trace list --json`
- `switchmaxxer trace show <trace-id> --json`
- `switchmaxxer trace stats --json`
- `switchmaxxer trace observations --json`
- `switchmaxxer trace verify --json`
- `switchmaxxer trace repair --json`
- `switchmaxxer prune --json`
- `switchmaxxer ledger list --json`
- `switchmaxxer ledger show <ledger-event-id> --json`
- `switchmaxxer bench list --json`
- `switchmaxxer bench show <run-id> --json`
- `switchmaxxer bench --json`
- `switchmaxxer bench prune --json`
- `switchmaxxer bench delete <run-id> --json`
- `switchmaxxer bench clear --json`
- `switchmaxxer optimize --json`
- `switchmaxxer optimize list --json`
- `switchmaxxer optimize show <run-id> --json`
- `switchmaxxer optimize apply <run-id> --route <route-id> --json`
- `switchmaxxer optimize restore <apply-action-id|run-id> --json`
- `switchmaxxer optimize prune --older-than <duration> --json`
- `switchmaxxer optimize delete <run-id> --json`
- `switchmaxxer optimize clear --json`

Config display note:

- `switchmaxxer config show --json` returns a redacted normalized config view
- it is not a byte-for-byte echo of the file on disk
- inline secrets are masked before serialization
- formatting and whitespace should not be treated as preserved contract

The same supported contract is exposed through `switchmaxxer mcp serve` with these MCP tool names:

- config discovery and validation: `config_schema`, `config_show`, `config_validate`
- config CRUD: `models_list`, `models_show`, `models_create`, `models_update`, `models_delete`, `providers_list`, `providers_show`, `providers_create`, `providers_update`, `providers_delete`, `providers_set_key`, `providers_clear_key`, `providers_set_key_env`, `routes_list`, `routes_show`, `routes_explain`, `routes_create`, `routes_update`, `routes_delete`
- gateway inspection: `gateway_health`, `gateway_status`, `gateway_runtime_config`
- observability: `trace_list`, `trace_show`, `trace_stats`, `trace_observations`, `trace_verify`, `trace_repair`, `prune`, `bench_list`, `bench_show`, `bench_run`, `optimize_list`, `optimize_show`, `optimize_run`, `optimize_apply`, `optimize_restore`, `ledger_list`, `ledger_show`

Optimize apply/restore parity:

- MCP `optimize_apply.reload` and `optimize_restore.reload` mirror CLI `--reload`.
- MCP `optimize_apply.verify` and `optimize_restore.verify` mirror CLI `--verify`.
- For non-dry-run requests with either post-action enabled, both surfaces defer
  Ledger completion until the reload/verification result has been attached to
  the payload and Ledger result.

Specific field-level guarantees in this document are strongest for:

- `config schema --json`
- `models show --json`
- `providers show --json`
- `routes show --json`
- `trace list --json`
- `trace show --json`
- `trace stats --json`
- `trace observations --json`
- `trace verify --json`
- `trace repair --json`
- `bench list --json`
- `bench show --json`
- `bench --json`
- `ledger list --json`
- `ledger show --json`
- JSON mutation failure envelopes on config CRUD surfaces

## Mutation Validation Parity

CLI and MCP config mutations share one semantic validation layer for entity
create/update operations. A model, provider, or route mutation accepted by one
surface should be accepted by the other when the caller has equivalent
capabilities and supplies equivalent input. A mutation rejected by one surface
should be rejected by the other with the same stable error category, even when
the surrounding transport or presentation wording differs.

Boundary adapters may differ by surface:

- CLI adapters parse flags, stdin, and `--json-input`
- MCP adapters validate JSON tool arguments and capability grants
- each surface formats its own envelope

Those adapters must not implement weaker entity semantics than the shared
mutation runtime. Canonical entity validation belongs below both surfaces, and
surface-specific code should only normalize input, enforce transport/capability
rules, and map shared validation failures into the documented error envelope.

Route mutation validation follows the same rule. The shared mutation runtime is
the authority for persisted route shape, including `display_name`, `model`,
`service_provider`, `provider_model_id`, `timeout_ms`, and `cost`. CLI and MCP
may reject malformed route input earlier for interface-specific usability, but
neither surface may persist a route whose final stored state bypasses canonical
route validation or reference checks.

## Benchmark Path Selection Alignment

Benchmark execution path selection is a shared CLI/MCP contract.

Current aligned surfaces:

- CLI: `switchmaxxer bench --path <gateway|direct|both>`
- MCP: `bench_run` with `path_mode: "gateway" | "direct" | "both"`

These values represent the same execution-path choice and should stay aligned.

Semantic intent:

- `gateway`: benchmark through the live local gateway path
- `direct`: benchmark direct upstream provider calls
- `both`: request both paths and allow the runtime to degrade to the available
  subset when the gateway path cannot be used

## Common Envelope

Successful responses use:

```json
{
  "ok": true,
  "command": "string",
  "schema_version": "1",
  "data": {}
}
```

Entity show commands may also include:

```json
{
  "editability": {
    "writable": ["..."],
    "derived": ["..."],
    "effective": ["..."]
  }
}
```

Counter contract:

- `count` is reserved for list cardinality only
- non-list surfaces use explicit top-level counters such as `observation_count`, `sample_count`, and `result_count`
- custom top-level fields must not override reserved envelope fields:
  `ok`, `command`, `schema_version`, `data`, `count`, `warnings`,
  `details`, `normalized_fields`, `editability`, or `error`

Failed responses use:

```json
{
  "ok": false,
  "command": "string",
  "schema_version": "1",
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

Failed responses may include a top-level `details` object. CLI and MCP
surfaces sanitize these details before returning them: sensitive keys such as
tokens, API keys, authorization headers, passwords, and nested secret-shaped
fields are removed, while public metadata such as `api_key_env` is preserved.

## Entity Show Contracts

### `models show --json`

`data` fields:

- `name`
- `display_name`
- `model_creator`
- `route_count`
- `cost`

`editability` fields:

- `writable`: `display_name`, `model_creator`, `cost`
- `derived`: `name`, `route_count`
- `effective`: none

### `providers show --json`

`data` fields:

- `name`
- `api_mode`
- `endpoint`
- `anthropic_version`
- `auth_source`
- `api_key_env`
- `api_key`

Provider secret-field rule:

- `api_key` is a masked display-safe value when present, not the raw secret
- `api_key` may be `null`
- `auth_source` may be `inline override`, `secrets override`, `env var`, or
  `not required`
- MCP/TUI clients must not treat `providers show --json` as a secret-retrieval surface

`editability` fields:

- `writable`: `endpoint`, `allow_private_endpoints`, `allow_insecure_http`, `api_mode`, `anthropic_version`, `model_id_format`, `api_key_env`
- `derived`: `name`, `auth_source`
- `effective`: none

Inline secret update rule:

- MCP `providers_create` is a mutation-capability metadata create surface and
  does not accept `api_key`, `api_key_env`, or `no_auth`
- `providers update` is not the inline-secret mutation surface
- MCP `providers_update` requires the `privileged` capability when changing
  provider auth fields such as `api_key_env`
- use `providers set-key`, `providers set-key-env`, or `providers clear-key`
  for provider auth changes

### `routes show --json`

`data` fields:

- `name`
- `display_name`
- `model`
- `service_provider`
- `provider_model_id`
- `api_mode`
- `timeout_ms`
- `effective_timeout_ms`
- `cost`
- `model_cost`
- `effective_cost`

`editability` fields:

- `writable`: `display_name`, `model`, `service_provider`, `provider_model_id`, `timeout_ms`, `cost`
- `derived`: `name`, `api_mode`, `model_cost`
- `effective`: `effective_cost`, `effective_timeout_ms`

Important semantic rule:

- `route.cost` overrides `model.cost` when both are present

## `config schema --json`

`config schema --json` is the richer CLI discovery surface. The MCP `config_schema` tool uses the same core entity/field semantics, but intentionally omits CLI-only affordances such as command names, flag names, and structured-input hints.

Top-level `data` fields:

- `entities`
- `error_codes`

Current entity keys:

- `model`
- `provider`
- `route`

Each entity includes:

- `list_command`
- `show_command`
- `create_command`
- `update_command`
- `delete_command`
- `show_includes_editability`
- `structured_input`
- `delete_constraints`
- `state_errors`
- `fields`

Each field entry may include:

- `type`
- `role`
- `required_on_create`
- `writable_on`
- `mutation_mode`
- `flag`
- `flags`
- `clearable_on_update`
- `clear_flag`
- `values`
- `constraints`
- `derived`
- `effective`

This is intentionally lightweight metadata, not a full JSON Schema implementation.

`error_codes` includes:

- `mutation_usage`
- `entity_state`

This lets MCP/TUI clients discover the supported stable error-code families without hardcoding them separately from the schema surface.

## Mutation Error Codes

The following error codes are part of the current supported mutation-usage contract and are also exposed through `config schema --json` under `error_codes.mutation_usage`:

- `missing_required_field`
- `missing_flag_value`
- `invalid_flag_value`
- `conflicting_structured_input`
- `conflicting_input_modes`
- `conflicting_cost_flags`
- `incomplete_cost_flags`
- `unsupported_clear_cost`
- `invalid_input_field`
- `missing_update_fields`

The following entity/state error codes are also supported on current config CRUD surfaces and are also exposed through `config schema --json` under `error_codes.entity_state`:

- `model_not_found`
- `provider_not_found`
- `route_not_found`
- `model_already_exists`
- `provider_already_exists`
- `route_already_exists`
- `model_in_use`
- `provider_in_use`
- `unknown_model`
- `unknown_service_provider`

## Contract Stability

Current contract rules:

- additive fields are allowed
- new entity keys in `config schema` are allowed
- new error codes may be added when they represent new distinct failure classes
- some current error codes remain operation-specific by design and double as
  stable documentation/contract anchors even when the envelope `command` field
  already carries operation context
- existing field names should not be renamed silently
- existing supported fields should not be removed silently
- existing error codes should not be repurposed to mean something materially different

What clients should assume:

- field presence documented here is stable
- field order should not be treated as semantically meaningful
- undocumented fields may appear later
- unknown fields should be ignored safely by MCP/TUI clients

## Testing Status

The supported metadata builders and field sets are covered in:

- [src/subsystems/observability/observability.test.ts](../../src/subsystems/observability/observability.test.ts)

The supported end-to-end CLI JSON envelopes are covered in:

- [tests/test-013-mcp-cli-contract.sh](../../tests/test-013-mcp-cli-contract.sh)
- [tests/test-014-mcp-cli-negative-state-contract.sh](../../tests/test-014-mcp-cli-negative-state-contract.sh)
- [tests/test-015-mcp-serve-contract.sh](../../tests/test-015-mcp-serve-contract.sh)
- [tests/test-016-mcp-observability-contract.sh](../../tests/test-016-mcp-observability-contract.sh)
- [tests/test-017-mcp-observability-negative-contract.sh](../../tests/test-017-mcp-observability-negative-contract.sh)
- [tests/test-018-mcp-observability-ops-contract.sh](../../tests/test-018-mcp-observability-ops-contract.sh)
- [tests/test-019-mcp-serve-long-lived-session.sh](../../tests/test-019-mcp-serve-long-lived-session.sh)
- [tests/test-020-mcp-config-crud-long-lived-session.sh](../../tests/test-020-mcp-config-crud-long-lived-session.sh)

Current test posture:

- metadata field presence and shape are locked
- `config schema --json` includes machine-readable error-code families
- negative lookup/state error codes are locked
- `mcp serve` is shell-tested for positive config/control-plane behavior
- `mcp serve` is shell-tested for positive observability read behavior
- `mcp serve` is shell-tested for negative observability not-found and invalid-input behavior
- `mcp serve` is shell-tested for observability operations through `trace_repair`, `prune`, and `bench_run`
- optimize MCP parity is unit-tested for `optimize_run`, `optimize_list`, and `optimize_show`
- `mcp serve` is shell-tested across a real long-lived config CRUD session on one stdio connection
- `mcp serve` is shell-tested across a real long-lived mixed-operation session on one stdio connection
- field order is intentionally not treated as semantically meaningful
