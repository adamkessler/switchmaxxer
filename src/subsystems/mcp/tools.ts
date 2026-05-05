import { MCP_USAGE_ERROR_CODES } from "../config/config-metadata";
import { APP_ERROR_CODES, type AppErrorCode as McpErrorCode } from "../../platform/error-codes";
import {
  BENCH_MAX_CONCURRENCY,
  BENCH_MAX_ITERATIONS,
  BENCH_MAX_PROMPT_LENGTH,
  BENCH_MAX_ROUTES
} from "../observability/bench-limits";
import { OBSERVATION_EVENTS, OBSERVATION_KINDS, OBSERVATION_OUTCOMES } from "../observability/types";
import {
  CONTROL_PLANE_ACTION_OPERATIONS,
  CONTROL_PLANE_ACTION_STATUSES,
  CONTROL_PLANE_ACTION_SOURCE_SURFACES,
  CONTROL_PLANE_ACTION_TARGET_KINDS
} from "../observability/control-plane-actions";
import { DEFAULT_MCP_TOOL_CAPABILITIES } from "../../platform/mcp-capabilities";
import { isRecord } from "../../platform/type-guards";
import { API_MODES, MODEL_ID_FORMATS } from "../../platform/types";
import type { McpSessionContext, McpToolCapability, McpToolDefinition, ToolInputSchema } from "./types";

function defineTool(
  capability: McpToolCapability,
  name: string,
  description: string,
  inputSchema: Record<string, unknown>
): McpToolDefinition {
  return {
    capability,
    name,
    description,
    inputSchema
  };
}

function buildCostInputSchema(options: { allowNull: boolean }): ToolInputSchema {
  return {
    type: options.allowNull ? ["object", "null"] : "object",
    additionalProperties: false,
    properties: {
      input: { type: "number", minimum: 0 },
      output: { type: "number", minimum: 0 },
      cache_read: { type: "number", minimum: 0 },
      cache_write: { type: "number", minimum: 0 }
    },
    required: ["input", "output", "cache_read", "cache_write"]
  };
}

export function getToolEnvelopeCommand(toolName: string): string {
  const toolCommandMap: Record<string, string> = {
    config_schema: "config schema",
    config_validate: "config validate",
    config_show: "config show",
    models_list: "models list",
    models_show: "models show",
    models_create: "models create",
    models_update: "models update",
    models_delete: "models delete",
    providers_list: "providers list",
    providers_show: "providers show",
    providers_create: "providers create",
    providers_update: "providers update",
    providers_delete: "providers delete",
    providers_set_key: "providers set-key",
    providers_clear_key: "providers clear-key",
    providers_set_key_env: "providers set-key-env",
    routes_list: "routes list",
    routes_show: "routes show",
    routes_explain: "routes explain",
    routes_create: "routes create",
    routes_update: "routes update",
    routes_delete: "routes delete",
    gateway_health: "gateway health",
    gateway_status: "gateway status",
    gateway_runtime_config: "gateway runtime config",
    trace_list: "trace list",
    trace_show: "trace show",
    trace_stats: "trace stats",
    trace_observations: "trace observations",
    trace_verify: "trace verify",
    trace_repair: "trace repair",
    prune: "prune",
    ledger_list: "ledger list",
    ledger_show: "ledger show",
    bench_list: "bench list",
    bench_show: "bench show",
    bench_run: "bench",
    optimize_list: "optimize list",
    optimize_show: "optimize show",
    optimize_run: "optimize",
    optimize_apply: "optimize apply",
    optimize_restore: "optimize restore"
  };

  return toolCommandMap[toolName] ?? toolName.replaceAll("_", " ");
}

export function getToolDefinitions(): McpToolDefinition[] {
  return [
    defineTool("read", "config_schema", "Return the supported machine-facing config schema metadata for Switchmaxxer.", { type: "object", additionalProperties: false, properties: {} }),
    defineTool("read", "config_validate", "Validate the selected Switchmaxxer config.json for runtime use.", { type: "object", additionalProperties: false, properties: {} }),
    defineTool("read", "config_show", "Return the current Switchmaxxer config document and source path.", { type: "object", additionalProperties: false, properties: {} }),
    defineTool("read", "models_list", "List canonical models from the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: {} }),
    defineTool("read", "models_show", "Show one canonical model from the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { model_id: { type: "string", minLength: 1 } }, required: ["model_id"] }),
    defineTool("mutation", "models_create", "Create one canonical model in the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { model_id: { type: "string", minLength: 1 }, display_name: { type: "string", minLength: 1 }, model_creator: { type: "string", minLength: 1 }, cost: buildCostInputSchema({ allowNull: true }) }, required: ["model_id", "display_name", "model_creator"] }),
    defineTool("mutation", "models_update", "Update one canonical model in the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { model_id: { type: "string", minLength: 1 }, display_name: { type: "string", minLength: 1 }, model_creator: { type: "string", minLength: 1 }, cost: buildCostInputSchema({ allowNull: true }) }, required: ["model_id"] }),
    defineTool("mutation", "models_delete", "Delete one canonical model from the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { model_id: { type: "string", minLength: 1 } }, required: ["model_id"] }),
    defineTool("read", "providers_list", "List configured service providers from the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: {} }),
    defineTool("read", "providers_show", "Show one configured service provider from the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { provider_id: { type: "string", minLength: 1 } }, required: ["provider_id"] }),
    defineTool("mutation", "providers_create", "Create one configured service provider in the active Switchmaxxer config without auth material. Use providers_set_key or providers_set_key_env afterward for provider auth. The optional 'no_auth' field is accepted for symmetry with providers_update; if provided it must be true (providers_create always creates a no-auth provider).", { type: "object", additionalProperties: false, properties: { provider_id: { type: "string", minLength: 1 }, endpoint: { type: "string", minLength: 1 }, allow_private_endpoints: { type: "boolean" }, allow_insecure_http: { type: "boolean" }, api_mode: { type: "string", enum: [...API_MODES] }, anthropic_version: { type: ["string", "null"], minLength: 1 }, model_id_format: { type: "string", enum: [...MODEL_ID_FORMATS] }, no_auth: { type: "boolean" } }, required: ["provider_id", "endpoint", "api_mode"] }),
    defineTool("mutation", "providers_update", "Update one configured service provider in the active Switchmaxxer config. Inline api_key is not accepted here; use providers_set_key or providers_clear_key for inline api_key changes.", { type: "object", additionalProperties: false, properties: { provider_id: { type: "string", minLength: 1 }, endpoint: { type: "string", minLength: 1 }, allow_private_endpoints: { type: "boolean" }, allow_insecure_http: { type: "boolean" }, api_mode: { type: "string", enum: [...API_MODES] }, anthropic_version: { type: ["string", "null"], minLength: 1 }, model_id_format: { type: "string", enum: [...MODEL_ID_FORMATS] }, api_key_env: { type: ["string", "null"], minLength: 1 }, no_auth: { type: "boolean" } }, required: ["provider_id"] }),
    defineTool("mutation", "providers_delete", "Delete one configured service provider from the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { provider_id: { type: "string", minLength: 1 } }, required: ["provider_id"] }),
    defineTool("privileged", "providers_set_key", "Set one provider inline api_key in the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { provider_id: { type: "string", minLength: 1 }, api_key: { type: "string", minLength: 1 } }, required: ["provider_id", "api_key"] }),
    defineTool("privileged", "providers_clear_key", "Clear one provider inline api_key in the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { provider_id: { type: "string", minLength: 1 } }, required: ["provider_id"] }),
    defineTool("privileged", "providers_set_key_env", "Set one provider api_key_env in the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { provider_id: { type: "string", minLength: 1 }, api_key_env: { type: "string", minLength: 1 } }, required: ["provider_id", "api_key_env"] }),
    defineTool("read", "routes_list", "List configured routes from the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: {} }),
    defineTool("read", "routes_show", "Show one configured route from the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { route_id: { type: "string", minLength: 1 } }, required: ["route_id"] }),
    defineTool("read", "routes_explain", "Explain the meaning of one configured route in operator-facing terms.", { type: "object", additionalProperties: false, properties: { route_id: { type: "string", minLength: 1 } }, required: ["route_id"] }),
    defineTool("mutation", "routes_create", "Create one configured route in the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { route_id: { type: "string", minLength: 1 }, model: { type: "string", minLength: 1 }, service_provider: { type: "string", minLength: 1 }, provider_model_id: { type: "string", minLength: 1 }, display_name: { type: "string", minLength: 1 }, timeout_ms: { type: "integer", minimum: 1 }, cost: buildCostInputSchema({ allowNull: true }) }, required: ["route_id", "model", "service_provider", "provider_model_id", "display_name"] }),
    defineTool("mutation", "routes_update", "Update one configured route in the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { route_id: { type: "string", minLength: 1 }, model: { type: "string", minLength: 1 }, service_provider: { type: "string", minLength: 1 }, provider_model_id: { type: "string", minLength: 1 }, display_name: { type: "string", minLength: 1 }, timeout_ms: { type: ["integer", "null"], minimum: 1 }, cost: buildCostInputSchema({ allowNull: true }) }, required: ["route_id"] }),
    defineTool("mutation", "routes_delete", "Delete one configured route from the active Switchmaxxer config.", { type: "object", additionalProperties: false, properties: { route_id: { type: "string", minLength: 1 } }, required: ["route_id"] }),
    defineTool("read", "gateway_health", "Return a health snapshot for the local gateway and selected config.", { type: "object", additionalProperties: false, properties: { check: { type: "string", enum: ["gateway", "config", "providers", "routes", "all"] }, timeout_ms: { type: "integer", minimum: 1 } } }),
    defineTool("read", "gateway_status", "Return a status snapshot for the local gateway listener and selected config.", { type: "object", additionalProperties: false, properties: {} }),
    defineTool("read", "gateway_runtime_config", "Fetch the live gateway runtime config endpoint for the selected config.", { type: "object", additionalProperties: false, properties: {} }),
    defineTool("read", "trace_list", "List persisted request traces from the local Switchmaxxer observability store.", { type: "object", additionalProperties: false, properties: { route_id: { type: "string", minLength: 1 }, provider_id: { type: "string", minLength: 1 }, outcome: { type: "string", enum: [...OBSERVATION_OUTCOMES] }, limit: { type: "integer", minimum: 1 } } }),
    defineTool("read", "trace_show", "Show one persisted trace with observations and linked benchmark samples.", { type: "object", additionalProperties: false, properties: { trace_id: { type: "string", minLength: 1 } }, required: ["trace_id"] }),
    defineTool("read", "trace_stats", "Return aggregate persisted trace stats from the local observability store.", { type: "object", additionalProperties: false, properties: { route_id: { type: "string", minLength: 1 }, provider_id: { type: "string", minLength: 1 }, outcome: { type: "string", enum: [...OBSERVATION_OUTCOMES] } } }),
    defineTool("read", "trace_observations", "List persisted raw observations from the local Switchmaxxer observability store.", { type: "object", additionalProperties: false, properties: { route_id: { type: "string", minLength: 1 }, provider_id: { type: "string", minLength: 1 }, kind: { type: "string", enum: [...OBSERVATION_KINDS] }, event: { type: "string", enum: [...OBSERVATION_EVENTS] }, limit: { type: "integer", minimum: 1 } } }),
    defineTool("read", "trace_verify", "Verify that persisted request execution summaries still match canonical observations.", { type: "object", additionalProperties: false, properties: { trace_id: { type: "string", minLength: 1 }, all: { type: "boolean" }, batch_size: { type: "integer", minimum: 1 } } }),
    defineTool("mutation", "trace_repair", "Repair persisted request execution summaries from canonical observations.", { type: "object", additionalProperties: false, properties: { trace_id: { type: "string", minLength: 1 }, all: { type: "boolean" }, batch_size: { type: "integer", minimum: 1 } } }),
    defineTool("privileged", "prune", "Prune persisted observability rows older than a retention duration from the local Switchmaxxer observability store.", { type: "object", additionalProperties: false, properties: { older_than: { type: "string", minLength: 2 } } }),
    defineTool("privileged", "ledger_list", "List Control Plane Audit Ledger events from the local Switchmaxxer observability store.", { type: "object", additionalProperties: false, properties: { route_id: { type: "string", minLength: 1 }, target_id: { type: "string", minLength: 1 }, target_kind: { type: "string", enum: [...CONTROL_PLANE_ACTION_TARGET_KINDS] }, operation: { type: "string", enum: [...CONTROL_PLANE_ACTION_OPERATIONS] }, status: { type: "string", enum: [...CONTROL_PLANE_ACTION_STATUSES] }, source_surface: { type: "string", enum: [...CONTROL_PLANE_ACTION_SOURCE_SURFACES] }, session_id: { type: "string", minLength: 1 }, own_session: { type: "boolean" }, run_id: { type: "string", minLength: 1 }, mutation_event_id: { type: "string", minLength: 1 }, since: { type: "string", minLength: 2 }, limit: { type: "integer", minimum: 1 } } }),
    defineTool("privileged", "ledger_show", "Show one Control Plane Audit Ledger event from the local Switchmaxxer observability store.", { type: "object", additionalProperties: false, properties: { ledger_event_id: { type: "string", minLength: 1 } }, required: ["ledger_event_id"] }),
    defineTool("read", "bench_list", "List persisted benchmark runs from the local Switchmaxxer observability store.", { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1 } } }),
    defineTool("read", "bench_show", "Show one persisted benchmark run report from the local Switchmaxxer observability store.", { type: "object", additionalProperties: false, properties: { run_id: { type: "string", minLength: 1 } }, required: ["run_id"] }),
    defineTool("read", "optimize_list", "List persisted optimization runs from the local Switchmaxxer observability store.", { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1 } } }),
    defineTool("read", "optimize_show", "Show one persisted optimization recommendation report from the local Switchmaxxer observability store.", { type: "object", additionalProperties: false, properties: { run_id: { type: "string", minLength: 1 } }, required: ["run_id"] }),
    defineTool(
      "privileged",
      "optimize_run",
      "Run a persisted route optimization recommendation for one canonical model.",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          model: { type: "string", minLength: 1 },
          objective: { type: "string", enum: ["cost", "latency"] },
          routes: { type: "array", minItems: 1, maxItems: BENCH_MAX_ROUTES, items: { type: "string", minLength: 1 } },
          input_tokens: { type: "integer", minimum: 0 },
          output_tokens: { type: "integer", minimum: 0 },
          cache_read_tokens: { type: "integer", minimum: 0 },
          cache_write_tokens: { type: "integer", minimum: 0 },
          prompt: { type: "string", minLength: 1, maxLength: BENCH_MAX_PROMPT_LENGTH },
          iterations: { type: "integer", minimum: 1, maximum: BENCH_MAX_ITERATIONS },
          warmup: { type: "integer", minimum: 0 },
          concurrency: { type: "integer", minimum: 1, maximum: BENCH_MAX_CONCURRENCY },
          path_mode: { type: "string", enum: ["gateway", "direct", "both"] },
          timeout_ms: { type: "integer", minimum: 1 }
        },
        required: ["model", "objective"]
      }
    ),
    defineTool(
      "mutation",
      "optimize_apply",
      "Apply one persisted optimization winner to an existing route by changing its provider binding. reload and verify require the MCP server to be started with optimizePostActions runtime dependencies.",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          run_id: { type: "string", minLength: 1 },
          route_id: { type: "string", minLength: 1 },
          dry_run: { type: "boolean" },
          reload: { type: "boolean" },
          verify: { type: "boolean" }
        },
        required: ["run_id", "route_id"]
      }
    ),
    defineTool(
      "mutation",
      "optimize_restore",
      "Restore the provider binding changed by a previous optimize_apply restore point. reload and verify require the MCP server to be started with optimizePostActions runtime dependencies.",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          action_id: { type: "string", minLength: 1 },
          run_id: { type: "string", minLength: 1 },
          route_id: { type: "string", minLength: 1 },
          dry_run: { type: "boolean" },
          reload: { type: "boolean" },
          verify: { type: "boolean" }
        },
        oneOf: [
          {
            type: "object",
            properties: {
              action_id: { type: "string", minLength: 1 }
            },
            required: ["action_id"]
          },
          {
            type: "object",
            properties: {
              run_id: { type: "string", minLength: 1 },
              route_id: { type: "string", minLength: 1 }
            },
            required: ["run_id", "route_id"]
          }
        ]
      }
    ),
    defineTool(
      "privileged",
      "bench_run",
      "Execute a persisted benchmark run through the local gateway, direct upstream providers, or both.",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          route_id: { type: "string", minLength: 1 },
          routes: { type: "array", minItems: 1, maxItems: BENCH_MAX_ROUTES, items: { type: "string", minLength: 1 } },
          prompt: { type: "string", minLength: 1, maxLength: BENCH_MAX_PROMPT_LENGTH },
          iterations: { type: "integer", minimum: 1, maximum: BENCH_MAX_ITERATIONS },
          warmup: { type: "integer", minimum: 0 },
          concurrency: { type: "integer", minimum: 1, maximum: BENCH_MAX_CONCURRENCY },
          path_mode: { type: "string", enum: ["gateway", "direct", "both"] },
          timeout_ms: { type: "integer", minimum: 1 }
        },
        required: ["prompt"],
        oneOf: [
          {
            type: "object",
            properties: {
              route_id: { type: "string", minLength: 1 }
            },
            required: ["route_id"]
          },
          {
            type: "object",
            properties: {
              routes: { type: "array", minItems: 1, maxItems: BENCH_MAX_ROUTES, items: { type: "string", minLength: 1 } }
            },
            required: ["routes"]
          }
        ]
      }
    )
  ];
}

export function getToolDefinition(toolName: string): McpToolDefinition | null {
  return getToolDefinitions().find((tool) => tool.name === toolName) ?? null;
}

export function isMcpMutationToolName(toolName: string): boolean {
  const toolDefinition = getToolDefinition(toolName);
  return toolDefinition?.capability !== "read";
}

export function getAllowedToolDefinitions(sessionContext?: Pick<McpSessionContext, "grantedCapabilities">): McpToolDefinition[] {
  const grantedCapabilities =
    sessionContext?.grantedCapabilities ?? new Set<McpToolCapability>(DEFAULT_MCP_TOOL_CAPABILITIES);
  return getToolDefinitions().filter((tool) => grantedCapabilities.has(tool.capability));
}

export function sessionCanCallTool(
  toolDefinition: Pick<McpToolDefinition, "capability">,
  sessionContext?: Pick<McpSessionContext, "grantedCapabilities">
): boolean {
  const grantedCapabilities =
    sessionContext?.grantedCapabilities ?? new Set<McpToolCapability>(DEFAULT_MCP_TOOL_CAPABILITIES);
  return grantedCapabilities.has(toolDefinition.capability);
}

export function formatMcpToolList(toolNames: string[]): string {
  return toolNames.map((toolName) => `  ${toolName}`).join("\n");
}

function valueMatchesSchemaType(value: unknown, expectedType: string): boolean {
  if (expectedType === "null") return value === null;
  if (expectedType === "string") return typeof value === "string";
  if (expectedType === "boolean") return typeof value === "boolean";
  if (expectedType === "number") return typeof value === "number" && Number.isFinite(value);
  if (expectedType === "integer") return typeof value === "number" && Number.isInteger(value);
  if (expectedType === "array") return Array.isArray(value);
  if (expectedType === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return false;
}

function describeSchemaType(type: string | string[]): string {
  return Array.isArray(type) ? type.join(" or ") : type;
}

function validateToolSchemaValue(value: unknown, schema: ToolInputSchema, fieldPath: string): { code: McpErrorCode; message: string } | null {
  const type = schema.type;
  if (type) {
    const allowedTypes = Array.isArray(type) ? type : [type];
    if (!allowedTypes.some((candidate) => valueMatchesSchemaType(value, candidate))) {
      return { code: fieldPath === "arguments" ? APP_ERROR_CODES.invalidToolInput : MCP_USAGE_ERROR_CODES.invalidInputField, message: fieldPath === "arguments" ? `Tool arguments must be a ${describeSchemaType(type)}.` : `field '${fieldPath}' must be ${describeSchemaType(type)}` };
    }
  }
  if (schema.enum && !schema.enum.some((candidate) => candidate === value)) {
    return { code: fieldPath === "arguments" ? APP_ERROR_CODES.invalidToolInput : MCP_USAGE_ERROR_CODES.invalidInputField, message: fieldPath === "arguments" ? `Tool arguments must be one of: ${schema.enum.join(", ")}` : `field '${fieldPath}' must be one of: ${schema.enum.join(", ")}` };
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      return { code: MCP_USAGE_ERROR_CODES.invalidInputField, message: `field '${fieldPath}' must be at least ${schema.minLength} characters` };
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      return { code: MCP_USAGE_ERROR_CODES.invalidInputField, message: `field '${fieldPath}' must be at most ${schema.maxLength} characters` };
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return { code: MCP_USAGE_ERROR_CODES.invalidInputField, message: `field '${fieldPath}' must be at least ${schema.minimum}` };
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return { code: MCP_USAGE_ERROR_CODES.invalidInputField, message: `field '${fieldPath}' must be at most ${schema.maximum}` };
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      return { code: MCP_USAGE_ERROR_CODES.invalidInputField, message: `field '${fieldPath}' must contain at least ${schema.minItems} item(s)` };
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const nested = validateToolSchemaValue(value[index], schema.items, `${fieldPath}[${index}]`);
        if (nested) return nested;
      }
    }
  }
  if (isRecord(value)) {
    const objectValue = value;
    const properties = schema.properties ?? {};
    const getNestedFieldPath = (key: string): string => fieldPath === "arguments" ? key : `${fieldPath}.${key}`;
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(objectValue)) {
        if (!Object.hasOwn(properties, key)) {
          return { code: MCP_USAGE_ERROR_CODES.invalidInputField, message: `field '${getNestedFieldPath(key)}' is not allowed` };
        }
      }
    }
    for (const requiredField of schema.required ?? []) {
      if (!Object.hasOwn(objectValue, requiredField)) {
        return { code: MCP_USAGE_ERROR_CODES.missingRequiredField, message: `Tool input requires '${getNestedFieldPath(requiredField)}'.` };
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.hasOwn(objectValue, key)) continue;
      const nested = validateToolSchemaValue(objectValue[key], propertySchema, getNestedFieldPath(key));
      if (nested) return nested;
    }
  }
  if (schema.oneOf) {
    const matchCount = schema.oneOf.reduce((count, candidateSchema) => {
      return validateToolSchemaValue(value, candidateSchema, fieldPath) === null ? count + 1 : count;
    }, 0);
    if (matchCount !== 1) {
      return fieldPath === "arguments"
        ? {
            code: APP_ERROR_CODES.invalidToolInput,
            message: "Tool arguments must provide exactly one of 'route_id' or 'routes'."
          }
        : {
            code: MCP_USAGE_ERROR_CODES.invalidInputField,
            message: `field '${fieldPath}' must satisfy exactly one schema branch`
          };
    }
  }
  return null;
}

export function validateToolArguments(toolDefinition: McpToolDefinition, args: unknown): { code: McpErrorCode; message: string } | null {
  return validateToolSchemaValue(args, toolDefinition.inputSchema as ToolInputSchema, "arguments");
}
