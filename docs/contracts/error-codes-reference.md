# Error Codes Reference

This document is generated from:

- `src/platform/error-codes.ts`
- `src/subsystems/config/config-metadata.ts`

Do not edit it by hand. Regenerate it with:

```bash
npm run docs:error-codes
```

## Purpose

These are the machine-facing error codes that can surface through CLI JSON
envelopes and MCP tool results.

Operators can also discover the canonical sets at runtime through:

```bash
switchmaxxer config schema --json
```

Use this reference when:

- interpreting `error.code` values from CLI or MCP automation
- checking whether a surfaced code is part of the supported contract
- reviewing docs or tests for source-synchronous error-code alignment

## Mutation Usage Errors

These mostly represent command-shape or field-validation failures before a
mutation is applied.

| Code | Meaning |
| --- | --- |
| `conflicting_cost_flags` | Cost flags were combined in a way the mutation contract does not allow. |
| `conflicting_input_modes` | Structured input was mixed with flags or modes that are mutually exclusive. |
| `conflicting_structured_input` | Multiple structured-input sources were provided when only one is allowed. |
| `incomplete_cost_flags` | A cost-flag set was only partially provided. |
| `invalid_flag_value` | A CLI flag value was syntactically present but invalid. |
| `invalid_input_field` | A provided field or flag failed command-level validation. |
| `missing_flag_value` | A CLI flag that requires a value was provided without one. |
| `missing_required_field` | A required structured-input field was not provided. |
| `missing_update_fields` | An update command was invoked without any writable fields to change. |
| `unsupported_clear_cost` | The requested cost-clearing mode is not supported for that command. |

## Entity State Errors

These represent config-entity existence, uniqueness, or dependency-state
failures.

| Code | Meaning |
| --- | --- |
| `model_already_exists` | The target model already exists. |
| `model_in_use` | The model cannot be deleted because another config object still references it. |
| `model_not_found` | The referenced model does not exist. |
| `provider_already_exists` | The target provider already exists. |
| `provider_in_use` | The provider cannot be deleted because another config object still references it. |
| `provider_not_found` | The referenced provider does not exist. |
| `route_already_exists` | The target route already exists. |
| `route_not_found` | The referenced route does not exist. |
| `unknown_model` | A referenced model identifier is not known in the current config document. |
| `unknown_service_provider` | A referenced service provider identifier is not known in the current config document. |

## App Surface Errors

These are the broader CLI and MCP runtime/operator codes layered on top of the
shared mutation-specific sets above.

| Code | Meaning |
| --- | --- |
| `auth_rate_limited` | Auth Rate Limited runtime failure. |
| `bench_error` | Benchmark execution failed after the run plan was accepted. |
| `bench_list_error` | Runtime or operational failure while handling `bench list`. |
| `bench_not_found` | The requested bench record does not exist. |
| `bench_show_error` | Runtime or operational failure while handling `bench show`. |
| `config_export_error` | A config export operation failed. |
| `config_import_error` | A config import failed after input was accepted. |
| `config_read_error` | Switchmaxxer could not read the config source. |
| `config_set_error` | A config set mutation failed after input validation. |
| `disable_error` | The gateway operator action `disable` failed. |
| `enable_error` | The gateway operator action `enable` failed. |
| `gateway_auth_error` | Gateway authentication or authorization failed. |
| `gateway_health_error` | A gateway health inspection failed. |
| `gateway_runtime_config_error` | Reading live gateway runtime config failed. |
| `gateway_status_error` | A gateway status inspection failed. |
| `gateway_unavailable` | The local gateway could not be reached or is not healthy enough for the requested operation. |
| `health_error` | A gateway health inspection failed. |
| `inline_api_key_override` | An unsafe inline API-key override was attempted where the command only accepts safer config/env paths. |
| `internal_error` | Internal Error runtime failure. |
| `invalid_config` | The config document is malformed or violates the config contract. |
| `invalid_header_value` | Invalid Header Value runtime failure. |
| `invalid_json` | Invalid Json runtime failure. |
| `invalid_request` | The request payload was malformed for the target surface. |
| `invalid_tool_input` | Tool input failed validation before execution. |
| `invoke_error` | A one-off invoke command failed after request construction. |
| `ledger_list_error` | Ledger List Error runtime failure. |
| `ledger_not_found` | Ledger Not Found runtime failure. |
| `ledger_show_error` | Ledger Show Error runtime failure. |
| `logs_error` | A gateway log retrieval operation failed. |
| `misdirected_request` | Misdirected Request runtime failure. |
| `missing_env_var` | A required environment variable is unset or empty. |
| `models_create_error` | Runtime or operational failure while handling `models create`. |
| `models_delete_error` | Runtime or operational failure while handling `models delete`. |
| `models_list_error` | Runtime or operational failure while handling `models list`. |
| `models_show_error` | Runtime or operational failure while handling `models show`. |
| `models_update_error` | Runtime or operational failure while handling `models update`. |
| `not_found` | Not Found runtime failure. |
| `optimize_error` | Optimize execution failed after the request shape was accepted. |
| `optimize_insufficient_candidates` | The optimize target had fewer than two candidate routes. |
| `optimize_list_error` | Runtime or operational failure while handling `optimize list`. |
| `optimize_no_candidates` | No configured routes matched the requested optimize target. |
| `optimize_not_found` | The requested optimize record does not exist. |
| `optimize_objective_no_data` | No candidate route had enough data for the selected optimize objective. |
| `optimize_route_model_mismatch` | An explicitly selected optimize route did not target the requested model. |
| `optimize_show_error` | Runtime or operational failure while handling `optimize show`. |
| `payload_too_large` | Payload Too Large runtime failure. |
| `providers_clear_key_error` | Runtime or operational failure while handling `providers clear key`. |
| `providers_create_error` | Runtime or operational failure while handling `providers create`. |
| `providers_delete_error` | Runtime or operational failure while handling `providers delete`. |
| `providers_list_error` | Runtime or operational failure while handling `providers list`. |
| `providers_set_key_env_error` | Runtime or operational failure while handling `providers set key env`. |
| `providers_set_key_error` | Runtime or operational failure while handling `providers set key`. |
| `providers_show_error` | Runtime or operational failure while handling `providers show`. |
| `providers_update_error` | Runtime or operational failure while handling `providers update`. |
| `prune_error` | Whole-store observability retention pruning failed. |
| `rate_limited` | Rate Limited runtime failure. |
| `reload_error` | The gateway operator action `reload` failed. |
| `request_parse_capacity_exceeded` | Request Parse Capacity Exceeded runtime failure. |
| `request_timeout` | Request Timeout runtime failure. |
| `restart_error` | The gateway operator action `restart` failed. |
| `route_test_error` | A route test operation failed after the test plan was accepted. |
| `routes_create_error` | Runtime or operational failure while handling `routes create`. |
| `routes_delete_error` | Runtime or operational failure while handling `routes delete`. |
| `routes_explain_error` | Runtime or operational failure while handling `routes explain`. |
| `routes_list_error` | Runtime or operational failure while handling `routes list`. |
| `routes_show_error` | Runtime or operational failure while handling `routes show`. |
| `routes_update_error` | Runtime or operational failure while handling `routes update`. |
| `start_error` | The gateway operator action `start` failed. |
| `status_error` | A gateway status inspection failed. |
| `stdin_read_error` | Reading structured input from stdin failed. |
| `stop_error` | The gateway operator action `stop` failed. |
| `stream_capacity_exceeded` | Stream Capacity Exceeded runtime failure. |
| `tool_execution_error` | A built-in tool failed during execution. |
| `tool_not_found` | The requested built-in tool name is unknown. |
| `trace_list_error` | Runtime or operational failure while handling `trace list`. |
| `trace_not_found` | The requested trace record does not exist. |
| `trace_observations_error` | Runtime or operational failure while handling `trace observations`. |
| `trace_repair_error` | Runtime or operational failure while handling `trace repair`. |
| `trace_show_error` | Runtime or operational failure while handling `trace show`. |
| `trace_stats_error` | Runtime or operational failure while handling `trace stats`. |
| `trace_verify_error` | Runtime or operational failure while handling `trace verify`. |
| `unauthorized` | Unauthorized runtime failure. |
| `unsupported` | The requested command or mode is intentionally unsupported. |
| `unsupported_content_shape` | Unsupported Content Shape runtime failure. |
