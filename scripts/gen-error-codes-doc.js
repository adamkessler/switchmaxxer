#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

require("ts-node/register/transpile-only");

const { getContractSourcePaths } = require("./lib/contract-source-paths.js");
const { APP_ERROR_CODES } = require("../src/platform/error-codes.ts");
const {
  MCP_USAGE_ERROR_CODES,
  MCP_ENTITY_STATE_ERROR_CODES
} = require("../src/subsystems/config/config-metadata.ts");

function humanizeToken(token) {
  return token
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function describeUsageCode(code) {
  switch (code) {
    case "missing_required_field":
      return "A required structured-input field was not provided.";
    case "missing_flag_value":
      return "A CLI flag that requires a value was provided without one.";
    case "invalid_flag_value":
      return "A CLI flag value was syntactically present but invalid.";
    case "conflicting_structured_input":
      return "Multiple structured-input sources were provided when only one is allowed.";
    case "conflicting_input_modes":
      return "Structured input was mixed with flags or modes that are mutually exclusive.";
    case "conflicting_cost_flags":
      return "Cost flags were combined in a way the mutation contract does not allow.";
    case "incomplete_cost_flags":
      return "A cost-flag set was only partially provided.";
    case "unsupported_clear_cost":
      return "The requested cost-clearing mode is not supported for that command.";
    case "invalid_input_field":
      return "A provided field or flag failed command-level validation.";
    case "missing_update_fields":
      return "An update command was invoked without any writable fields to change.";
    default:
      return `${humanizeToken(code)} contract failure.`;
  }
}

function describeEntityStateCode(code) {
  switch (code) {
    case "model_not_found":
    case "provider_not_found":
    case "route_not_found":
      return `The referenced ${code.split("_")[0]} does not exist.`;
    case "model_already_exists":
    case "provider_already_exists":
    case "route_already_exists":
      return `The target ${code.split("_")[0]} already exists.`;
    case "model_in_use":
    case "provider_in_use":
      return `The ${code.split("_")[0]} cannot be deleted because another config object still references it.`;
    case "unknown_model":
      return "A referenced model identifier is not known in the current config document.";
    case "unknown_service_provider":
      return "A referenced service provider identifier is not known in the current config document.";
    default:
      return `${humanizeToken(code)} state failure.`;
  }
}

function describeAppCode(code) {
  const entityActionMatch = code.match(/^(models|providers|routes|trace|bench|optimize)_(.+)_error$/);
  if (entityActionMatch) {
    const [, family, action] = entityActionMatch;
    return `Runtime or operational failure while handling \`${family} ${action.replaceAll("_", " ")}\`.`;
  }

  switch (code) {
    case "invalid_tool_input":
      return "Tool input failed validation before execution.";
    case "invalid_config":
      return "The config document is malformed or violates the config contract.";
    case "gateway_unavailable":
      return "The local gateway could not be reached or is not healthy enough for the requested operation.";
    case "inline_api_key_override":
      return "An unsafe inline API-key override was attempted where the command only accepts safer config/env paths.";
    case "missing_env_var":
      return "A required environment variable is unset or empty.";
    case "config_read_error":
      return "Switchmaxxer could not read the config source.";
    case "config_import_error":
      return "A config import failed after input was accepted.";
    case "config_set_error":
      return "A config set mutation failed after input validation.";
    case "config_export_error":
      return "A config export operation failed.";
    case "invoke_error":
      return "A one-off invoke command failed after request construction.";
    case "route_test_error":
      return "A route test operation failed after the test plan was accepted.";
    case "gateway_auth_error":
      return "Gateway authentication or authorization failed.";
    case "unsupported":
      return "The requested command or mode is intentionally unsupported.";
    case "health_error":
    case "gateway_health_error":
      return "A gateway health inspection failed.";
    case "status_error":
    case "gateway_status_error":
      return "A gateway status inspection failed.";
    case "reload_error":
    case "start_error":
    case "stop_error":
    case "restart_error":
    case "enable_error":
    case "disable_error":
      return `The gateway operator action \`${code.replace("_error", "").replaceAll("_", " ")}\` failed.`;
    case "logs_error":
      return "A gateway log retrieval operation failed.";
    case "providers_set_key_error":
      return "Setting an inline provider API key failed.";
    case "providers_clear_key_error":
      return "Clearing a provider API key failed.";
    case "providers_set_key_env_error":
      return "Setting a provider API-key environment variable reference failed.";
    case "trace_not_found":
    case "bench_not_found":
    case "optimize_not_found":
      return `The requested ${code.split("_")[0]} record does not exist.`;
    case "trace_verify_error":
      return "Trace verification found an error or could not complete.";
    case "trace_repair_error":
      return "Trace repair could not complete successfully.";
    case "prune_error":
      return "Whole-store observability retention pruning failed.";
    case "gateway_runtime_config_error":
      return "Reading live gateway runtime config failed.";
    case "bench_error":
      return "Benchmark execution failed after the run plan was accepted.";
    case "optimize_error":
      return "Optimize execution failed after the request shape was accepted.";
    case "optimize_no_candidates":
      return "No configured routes matched the requested optimize target.";
    case "optimize_insufficient_candidates":
      return "The optimize target had fewer than two candidate routes.";
    case "optimize_route_model_mismatch":
      return "An explicitly selected optimize route did not target the requested model.";
    case "optimize_objective_no_data":
      return "No candidate route had enough data for the selected optimize objective.";
    case "tool_not_found":
      return "The requested built-in tool name is unknown.";
    case "invalid_request":
      return "The request payload was malformed for the target surface.";
    case "stdin_read_error":
      return "Reading structured input from stdin failed.";
    case "tool_execution_error":
      return "A built-in tool failed during execution.";
    default:
      return `${humanizeToken(code)} runtime failure.`;
  }
}

function buildRows(entries, describe) {
  return entries
    .map((code) => `| \`${code}\` | ${describe(code)} |`)
    .join("\n");
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function main() {
  const sourcePaths = getContractSourcePaths();
  const repoRoot = sourcePaths.repoRoot;
  const outputPath = sourcePaths.docs.errorCodesReference;

  const usageCodes = uniqueSorted(Object.values(MCP_USAGE_ERROR_CODES));
  const entityStateCodes = uniqueSorted(Object.values(MCP_ENTITY_STATE_ERROR_CODES));
  const appOnlyCodes = uniqueSorted(
    Object.values(APP_ERROR_CODES).filter(
      (code) => !usageCodes.includes(code) && !entityStateCodes.includes(code)
    )
  );

  const markdown = `# Error Codes Reference

This document is generated from:

- \`src/platform/error-codes.ts\`
- \`src/subsystems/config/config-metadata.ts\`

Do not edit it by hand. Regenerate it with:

\`\`\`bash
npm run docs:error-codes
\`\`\`

## Purpose

These are the machine-facing error codes that can surface through CLI JSON
envelopes and MCP tool results.

Operators can also discover the canonical sets at runtime through:

\`\`\`bash
switchmaxxer config schema --json
\`\`\`

Use this reference when:

- interpreting \`error.code\` values from CLI or MCP automation
- checking whether a surfaced code is part of the supported contract
- reviewing docs or tests for source-synchronous error-code alignment

## Mutation Usage Errors

These mostly represent command-shape or field-validation failures before a
mutation is applied.

| Code | Meaning |
| --- | --- |
${buildRows(usageCodes, describeUsageCode)}

## Entity State Errors

These represent config-entity existence, uniqueness, or dependency-state
failures.

| Code | Meaning |
| --- | --- |
${buildRows(entityStateCodes, describeEntityStateCode)}

## App Surface Errors

These are the broader CLI and MCP runtime/operator codes layered on top of the
shared mutation-specific sets above.

| Code | Meaning |
| --- | --- |
${buildRows(appOnlyCodes, describeAppCode)}
`;

  fs.writeFileSync(outputPath, markdown);
  process.stdout.write(`Wrote ${path.relative(repoRoot, outputPath)}\n`);
}

main();
