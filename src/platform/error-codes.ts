import { MCP_ENTITY_STATE_ERROR_CODES, MCP_USAGE_ERROR_CODES } from "../subsystems/config/config-metadata";

// Error-code contract:
//
// APP_ERROR_CODES is intentionally flatter and more operation-specific than a
// minimal generic taxonomy would be. In the current CLI/MCP envelope design,
// the `command` field already carries operation context, but many error codes
// still remain per-operation on purpose because they also act as stable
// documentation and machine-contract anchors.
//
// In practice that means:
// - the envelope `command` explains where the failure happened
// - the error `code` remains a stable lookup key for docs, tests, and clients
// - some codes therefore overlap in "failure class" while still differing by
//   operation, such as `trace_list_error` vs `trace_show_error`
//
// If the project ever decides to collapse this into a smaller generic taxonomy,
// treat that as an explicit contract change. Do not silently repurpose an
// existing code to mean something materially different just because another
// field already carries the operation name.
export const APP_ERROR_CODES = {
  ...MCP_USAGE_ERROR_CODES,
  ...MCP_ENTITY_STATE_ERROR_CODES,
  invalidToolInput: "invalid_tool_input",
  invalidConfig: "invalid_config",
  gatewayUnavailable: "gateway_unavailable",
  inlineApiKeyOverride: "inline_api_key_override",
  missingEnvVar: "missing_env_var",
  configReadError: "config_read_error",
  configImportError: "config_import_error",
  configSetError: "config_set_error",
  configExportError: "config_export_error",
  invokeError: "invoke_error",
  ledgerListError: "ledger_list_error",
  ledgerNotFound: "ledger_not_found",
  ledgerShowError: "ledger_show_error",
  routeTestError: "route_test_error",
  gatewayAuthError: "gateway_auth_error",
  unsupported: "unsupported",
  unauthorized: "unauthorized",
  authRateLimited: "auth_rate_limited",
  rateLimited: "rate_limited",
  misdirectedRequest: "misdirected_request",
  invalidJson: "invalid_json",
  payloadTooLarge: "payload_too_large",
  requestTimeout: "request_timeout",
  requestParseCapacityExceeded: "request_parse_capacity_exceeded",
  streamCapacityExceeded: "stream_capacity_exceeded",
  invalidHeaderValue: "invalid_header_value",
  unsupportedContentShape: "unsupported_content_shape",
  notFound: "not_found",
  internalError: "internal_error",
  healthError: "health_error",
  statusError: "status_error",
  reloadError: "reload_error",
  startError: "start_error",
  stopError: "stop_error",
  restartError: "restart_error",
  enableError: "enable_error",
  disableError: "disable_error",
  logsError: "logs_error",
  routesListError: "routes_list_error",
  routesShowError: "routes_show_error",
  routesExplainError: "routes_explain_error",
  modelsListError: "models_list_error",
  modelsShowError: "models_show_error",
  modelsCreateError: "models_create_error",
  modelsUpdateError: "models_update_error",
  modelsDeleteError: "models_delete_error",
  providersListError: "providers_list_error",
  providersShowError: "providers_show_error",
  providersCreateError: "providers_create_error",
  providersUpdateError: "providers_update_error",
  providersDeleteError: "providers_delete_error",
  providersSetKeyError: "providers_set_key_error",
  providersClearKeyError: "providers_clear_key_error",
  providersSetKeyEnvError: "providers_set_key_env_error",
  routesCreateError: "routes_create_error",
  routesUpdateError: "routes_update_error",
  routesDeleteError: "routes_delete_error",
  traceListError: "trace_list_error",
  traceNotFound: "trace_not_found",
  traceShowError: "trace_show_error",
  traceStatsError: "trace_stats_error",
  traceObservationsError: "trace_observations_error",
  traceVerifyError: "trace_verify_error",
  traceRepairError: "trace_repair_error",
  pruneError: "prune_error",
  gatewayRuntimeConfigError: "gateway_runtime_config_error",
  gatewayHealthError: "gateway_health_error",
  gatewayStatusError: "gateway_status_error",
  benchListError: "bench_list_error",
  benchNotFound: "bench_not_found",
  benchShowError: "bench_show_error",
  benchError: "bench_error",
  optimizeListError: "optimize_list_error",
  optimizeNotFound: "optimize_not_found",
  optimizeShowError: "optimize_show_error",
  optimizeError: "optimize_error",
  optimizePostActionsUnavailable: "optimize_post_actions_unavailable",
  optimizeNoCandidates: "optimize_no_candidates",
  optimizeInsufficientCandidates: "optimize_insufficient_candidates",
  optimizeRouteModelMismatch: "optimize_route_model_mismatch",
  optimizeObjectiveNoData: "optimize_objective_no_data",
  toolNotFound: "tool_not_found",
  invalidRequest: "invalid_request",
  stdinReadError: "stdin_read_error",
  toolExecutionError: "tool_execution_error"
} as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[keyof typeof APP_ERROR_CODES];
