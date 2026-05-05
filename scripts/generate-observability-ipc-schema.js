#!/usr/bin/env node

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const schemaDir = path.join(repoRoot, "src/subsystems/observability/ipc-schemas");
const schemaPath = path.join(schemaDir, "observability-ipc.schema.json");
const readmePath = path.join(schemaDir, "README.md");
const checkOnly = process.argv.includes("--check");

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://switchmaxxer.local/schemas/observability-ipc.schema.json",
  title: "Switchmaxxer Observability IPC Schema",
  type: "object",
  description: "Generated schema artifact for the observability IPC boundary. Initial coverage is selected observability operations.",
  $defs: {
    contractVersion: {
      const: "observability-module-v1",
      description: "Current semantic observability IPC contract version."
    },
    storeRef: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        }
      }
    },
    traceListFilters: {
      type: "object",
      additionalProperties: false,
      properties: {
        routeId: {
          type: "string",
          minLength: 1
        },
        providerId: {
          type: "string",
          minLength: 1
        },
        outcome: {
          type: "string",
          minLength: 1
        },
        limit: {
          type: "integer",
          minimum: 1
        }
      }
    },
    traceListPayload: {
      type: "object",
      additionalProperties: false,
      properties: {
        filters: {
          $ref: "#/$defs/traceListFilters"
        }
      }
    },
    traceListObservationsFilters: {
      type: "object",
      additionalProperties: false,
      properties: {
        requestId: {
          type: "string",
          minLength: 1
        },
        routeId: {
          type: "string",
          minLength: 1
        },
        providerId: {
          type: "string",
          minLength: 1
        },
        kind: {
          type: "string",
          minLength: 1
        },
        event: {
          type: "string",
          minLength: 1
        },
        limit: {
          type: "integer",
          minimum: 1
        }
      }
    },
    traceListObservationsPayload: {
      type: "object",
      additionalProperties: false,
      properties: {
        filters: {
          $ref: "#/$defs/traceListObservationsFilters"
        }
      }
    },
    traceGetStatsPayload: {
      type: "object",
      additionalProperties: false,
      properties: {
        filters: {
          $ref: "#/$defs/traceListFilters"
        }
      }
    },
    traceShowPayload: {
      type: "object",
      additionalProperties: false,
      required: ["traceId"],
      properties: {
        traceId: {
          type: "string",
          minLength: 1
        }
      }
    },
    ledgerListFilters: {
      type: "object",
      additionalProperties: false,
      properties: {
        routeId: {
          type: "string",
          minLength: 1
        },
        targetId: {
          type: "string",
          minLength: 1
        },
        targetKind: {
          type: "string",
          minLength: 1
        },
        operation: {
          type: "string",
          minLength: 1
        },
        status: {
          type: "string",
          minLength: 1
        },
        sourceSurface: {
          type: "string",
          minLength: 1
        },
        sessionId: {
          type: "string",
          minLength: 1
        },
        optimizationRunId: {
          type: "string",
          minLength: 1
        },
        mutationEventId: {
          type: "string",
          minLength: 1
        },
        createdSince: {
          type: "string",
          minLength: 1
        },
        limit: {
          type: "integer",
          minimum: 1
        }
      }
    },
    ledgerListPayload: {
      type: "object",
      additionalProperties: false,
      properties: {
        filters: {
          $ref: "#/$defs/ledgerListFilters"
        }
      }
    },
    ledgerShowPayload: {
      type: "object",
      additionalProperties: false,
      required: ["ledgerEventId"],
      properties: {
        ledgerEventId: {
          type: "string",
          minLength: 1
        }
      }
    },
    retentionPruneOlderThanPayload: {
      type: "object",
      additionalProperties: false,
      required: ["cutoffIso"],
      properties: {
        cutoffIso: {
          type: "string",
          minLength: 1
        }
      }
    },
    benchmarkHistoryListPayload: {
      type: "object",
      additionalProperties: false,
      required: ["limit"],
      properties: {
        limit: {
          type: "integer",
          minimum: 1
        }
      }
    },
    benchmarkHistoryShowPayload: {
      type: "object",
      additionalProperties: false,
      required: ["runId"],
      properties: {
        runId: {
          type: "string",
          minLength: 1
        }
      }
    },
    benchmarkHistoryPruneOlderThanPayload: {
      type: "object",
      additionalProperties: false,
      required: ["cutoffIso"],
      properties: {
        cutoffIso: {
          type: "string",
          minLength: 1
        }
      }
    },
    benchmarkHistoryDeleteRunPayload: {
      type: "object",
      additionalProperties: false,
      required: ["runId"],
      properties: {
        runId: {
          type: "string",
          minLength: 1
        }
      }
    },
    benchmarkHistoryClearPayload: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    jsonValue: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
        {
          type: "array",
          items: {
            $ref: "#/$defs/jsonValue"
          }
        },
        {
          type: "object",
          additionalProperties: {
            $ref: "#/$defs/jsonValue"
          }
        }
      ]
    },
    jsonObject: {
      type: "object",
      additionalProperties: {
        $ref: "#/$defs/jsonValue"
      }
    },
    externalOptimizeCatalogSnapshotContext: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "document"],
      properties: {
        kind: {
          const: "catalog_snapshot"
        },
        catalogRevision: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        document: {
          $ref: "#/$defs/jsonObject"
        },
        targetRoute: {
          $ref: "#/$defs/jsonObject"
        },
        winningRoute: {
          $ref: "#/$defs/jsonObject"
        },
        restorePoint: {
          $ref: "#/$defs/jsonObject"
        },
        providerAuth: {
          $ref: "#/$defs/jsonObject"
        }
      }
    },
    externalOptimizeNarrowedCatalogContext: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "targetRoute"],
      properties: {
        kind: {
          const: "narrowed_command_context"
        },
        catalogRevision: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        document: {
          $ref: "#/$defs/jsonObject"
        },
        targetRoute: {
          $ref: "#/$defs/jsonObject"
        },
        winningRoute: {
          $ref: "#/$defs/jsonObject"
        },
        restorePoint: {
          $ref: "#/$defs/jsonObject"
        },
        providerAuth: {
          $ref: "#/$defs/jsonObject"
        }
      }
    },
    externalOptimizeCatalogContext: {
      anyOf: [
        {
          $ref: "#/$defs/externalOptimizeCatalogSnapshotContext"
        },
        {
          $ref: "#/$defs/externalOptimizeNarrowedCatalogContext"
        }
      ]
    },
    externalOptimizeMutationCompletion: {
      type: "object",
      additionalProperties: false,
      properties: {
        reload: {
          anyOf: [{ $ref: "#/$defs/jsonObject" }, { type: "null" }]
        },
        verification: {
          anyOf: [{ $ref: "#/$defs/jsonObject" }, { type: "null" }]
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        },
        includePostActionResult: {
          type: "boolean"
        }
      }
    },
    externalOptimizeApplyCommand: {
      type: "object",
      additionalProperties: false,
      required: [
        "runId",
        "targetRouteId",
        "idempotencyKey",
        "dryRun",
        "reload",
        "verify",
        "createdBy",
        "sourceSurface",
        "actorKind",
        "catalog"
      ],
      properties: {
        runId: {
          type: "string",
          minLength: 1
        },
        targetRouteId: {
          type: "string",
          minLength: 1
        },
        idempotencyKey: {
          type: "string",
          minLength: 1
        },
        dryRun: {
          type: "boolean"
        },
        reload: {
          type: "boolean"
        },
        verify: {
          type: "boolean"
        },
        createdBy: {
          type: "string",
          minLength: 1
        },
        sourceSurface: {
          enum: ["cli", "mcp"]
        },
        actorKind: {
          enum: ["operator", "agent"]
        },
        actorId: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        sessionId: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        metadata: {
          $ref: "#/$defs/jsonObject"
        },
        catalog: {
          $ref: "#/$defs/externalOptimizeCatalogContext"
        },
        completion: {
          $ref: "#/$defs/externalOptimizeMutationCompletion"
        }
      }
    },
    externalOptimizeRestoreByActionCommand: {
      type: "object",
      additionalProperties: false,
      required: [
        "actionId",
        "idempotencyKey",
        "dryRun",
        "reload",
        "verify",
        "createdBy",
        "sourceSurface",
        "actorKind",
        "catalog"
      ],
      properties: {
        actionId: {
          type: "string",
          minLength: 1
        },
        idempotencyKey: {
          type: "string",
          minLength: 1
        },
        dryRun: {
          type: "boolean"
        },
        reload: {
          type: "boolean"
        },
        verify: {
          type: "boolean"
        },
        createdBy: {
          type: "string",
          minLength: 1
        },
        sourceSurface: {
          enum: ["cli", "mcp"]
        },
        actorKind: {
          enum: ["operator", "agent"]
        },
        actorId: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        sessionId: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        metadata: {
          $ref: "#/$defs/jsonObject"
        },
        catalog: {
          $ref: "#/$defs/externalOptimizeCatalogContext"
        },
        completion: {
          $ref: "#/$defs/externalOptimizeMutationCompletion"
        }
      }
    },
    externalOptimizeRestoreByRunRouteCommand: {
      type: "object",
      additionalProperties: false,
      required: [
        "runId",
        "targetRouteId",
        "idempotencyKey",
        "dryRun",
        "reload",
        "verify",
        "createdBy",
        "sourceSurface",
        "actorKind",
        "catalog"
      ],
      properties: {
        runId: {
          type: "string",
          minLength: 1
        },
        targetRouteId: {
          type: "string",
          minLength: 1
        },
        idempotencyKey: {
          type: "string",
          minLength: 1
        },
        dryRun: {
          type: "boolean"
        },
        reload: {
          type: "boolean"
        },
        verify: {
          type: "boolean"
        },
        createdBy: {
          type: "string",
          minLength: 1
        },
        sourceSurface: {
          enum: ["cli", "mcp"]
        },
        actorKind: {
          enum: ["operator", "agent"]
        },
        actorId: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        sessionId: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        metadata: {
          $ref: "#/$defs/jsonObject"
        },
        catalog: {
          $ref: "#/$defs/externalOptimizeCatalogContext"
        },
        completion: {
          $ref: "#/$defs/externalOptimizeMutationCompletion"
        }
      }
    },
    externalOptimizeRestoreCommand: {
      anyOf: [
        {
          $ref: "#/$defs/externalOptimizeRestoreByActionCommand"
        },
        {
          $ref: "#/$defs/externalOptimizeRestoreByRunRouteCommand"
        }
      ]
    },
    benchmarkGatewayPreflightSuccess: {
      type: "object",
      additionalProperties: false,
      required: ["ok", "sourceFile", "sourcePath", "bindHost", "port", "probeHost", "healthUrl", "pid", "latencyMs"],
      properties: {
        ok: {
          const: true
        },
        sourceFile: {
          type: "string",
          minLength: 1
        },
        sourcePath: {
          type: "string",
          minLength: 1
        },
        bindHost: {
          type: "string",
          minLength: 1
        },
        port: {
          type: "integer",
          minimum: 1
        },
        probeHost: {
          type: "string",
          minLength: 1
        },
        healthUrl: {
          type: "string",
          minLength: 1
        },
        pid: {
          anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }]
        },
        latencyMs: {
          anyOf: [{ type: "number", minimum: 0 }, { type: "null" }]
        }
      }
    },
    benchmarkGatewayPreflightFailure: {
      type: "object",
      additionalProperties: false,
      required: [
        "ok",
        "sourceFile",
        "sourcePath",
        "bindHost",
        "port",
        "probeHost",
        "healthUrl",
        "pid",
        "latencyMs",
        "code",
        "message"
      ],
      properties: {
        ok: {
          const: false
        },
        sourceFile: {
          type: "string",
          minLength: 1
        },
        sourcePath: {
          type: "string",
          minLength: 1
        },
        bindHost: {
          type: "string",
          minLength: 1
        },
        port: {
          anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }]
        },
        probeHost: {
          type: "string",
          minLength: 1
        },
        healthUrl: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        pid: {
          anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }]
        },
        latencyMs: {
          anyOf: [{ type: "number", minimum: 0 }, { type: "null" }]
        },
        code: {
          enum: ["invalid_config", "gateway_unavailable"]
        },
        message: {
          type: "string",
          minLength: 1
        }
      }
    },
    benchmarkRunsRunPayload: {
      type: "object",
      additionalProperties: false,
      required: [
        "config",
        "routeNames",
        "prompt",
        "iterations",
        "warmup",
        "concurrency",
        "pathMode",
        "gatewayPreflight",
        "createdBy",
        "objective",
        "taskPlanCommandName"
      ],
      properties: {
        config: {
          type: "object"
        },
        routeNames: {
          type: "array",
          minItems: 1,
          items: {
            type: "string",
            minLength: 1
          }
        },
        prompt: {
          type: "string",
          minLength: 1
        },
        iterations: {
          type: "integer",
          minimum: 1
        },
        warmup: {
          type: "integer",
          minimum: 0
        },
        concurrency: {
          type: "integer",
          minimum: 1
        },
        pathMode: {
          enum: ["gateway", "direct", "both"]
        },
        gatewayPreflight: {
          anyOf: [
            {
              $ref: "#/$defs/benchmarkGatewayPreflightSuccess"
            },
            {
              $ref: "#/$defs/benchmarkGatewayPreflightFailure"
            }
          ]
        },
        createdBy: {
          type: "string",
          minLength: 1
        },
        objective: {
          type: "string",
          minLength: 1
        },
        taskPlanCommandName: {
          enum: ["bench", "bench_run", "optimize", "optimize_run"]
        }
      }
    },
    optimizationHistoryListPayload: {
      type: "object",
      additionalProperties: false,
      required: ["limit"],
      properties: {
        limit: {
          type: "integer",
          minimum: 1
        }
      }
    },
    optimizationHistoryShowPayload: {
      type: "object",
      additionalProperties: false,
      required: ["runId"],
      properties: {
        runId: {
          type: "string",
          minLength: 1
        }
      }
    },
    optimizationHistoryPruneOlderThanPayload: {
      type: "object",
      additionalProperties: false,
      required: ["cutoffIso"],
      properties: {
        cutoffIso: {
          type: "string",
          minLength: 1
        }
      }
    },
    optimizationHistoryDeleteRunPayload: {
      type: "object",
      additionalProperties: false,
      required: ["runId"],
      properties: {
        runId: {
          type: "string",
          minLength: 1
        }
      }
    },
    optimizationHistoryClearPayload: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    optimizeReferenceTokens: {
      type: "object",
      additionalProperties: false,
      required: ["input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens"],
      properties: {
        input_tokens: {
          type: "integer",
          minimum: 0
        },
        output_tokens: {
          type: "integer",
          minimum: 0
        },
        cache_read_tokens: {
          type: "integer",
          minimum: 0
        },
        cache_write_tokens: {
          type: "integer",
          minimum: 0
        }
      }
    },
    costConfig: {
      type: "object",
      additionalProperties: false,
      required: ["input", "output", "cache_read", "cache_write"],
      properties: {
        input: {
          type: "number",
          minimum: 0
        },
        output: {
          type: "number",
          minimum: 0
        },
        cache_read: {
          type: "number",
          minimum: 0
        },
        cache_write: {
          type: "number",
          minimum: 0
        }
      }
    },
    optimizeCandidateRoute: {
      type: "object",
      additionalProperties: false,
      required: [
        "name",
        "model",
        "service_provider",
        "provider_model_id",
        "display_name",
        "api_mode",
        "cost",
        "model_cost",
        "effective_cost",
        "timeout_ms",
        "effective_timeout_ms"
      ],
      properties: {
        name: {
          type: "string",
          minLength: 1
        },
        model: {
          type: "string",
          minLength: 1
        },
        service_provider: {
          type: "string",
          minLength: 1
        },
        provider_model_id: {
          type: "string",
          minLength: 1
        },
        display_name: {
          type: "string",
          minLength: 1
        },
        api_mode: {
          type: "string",
          minLength: 1
        },
        cost: {
          anyOf: [{ $ref: "#/$defs/costConfig" }, { type: "null" }]
        },
        model_cost: {
          anyOf: [{ $ref: "#/$defs/costConfig" }, { type: "null" }]
        },
        effective_cost: {
          anyOf: [{ $ref: "#/$defs/costConfig" }, { type: "null" }]
        },
        timeout_ms: {
          anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }]
        },
        effective_timeout_ms: {
          anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }]
        }
      }
    },
    optimizationReportsPersistCostPayload: {
      type: "object",
      additionalProperties: false,
      required: ["report", "candidateRoutes", "requestedRoutes", "referenceTokens", "createdBy"],
      properties: {
        report: {
          allOf: [
            {
              $ref: "#/$defs/optimizeReportView"
            },
            {
              type: "object",
              properties: {
                run: {
                  type: "object",
                  properties: {
                    objective: {
                      const: "cost"
                    }
                  }
                }
              }
            }
          ]
        },
        candidateRoutes: {
          type: "array",
          items: {
            $ref: "#/$defs/optimizeCandidateRoute"
          }
        },
        requestedRoutes: {
          anyOf: [
            {
              type: "array",
              items: {
                type: "string",
                minLength: 1
              }
            },
            {
              type: "null"
            }
          ]
        },
        referenceTokens: {
          $ref: "#/$defs/optimizeReferenceTokens"
        },
        createdBy: {
          type: "string",
          minLength: 1
        },
        runId: {
          type: "string",
          minLength: 1
        }
      }
    },
    optimizationReportsPersistLatencyPayload: {
      type: "object",
      additionalProperties: false,
      required: ["report", "candidateRoutes", "requestedRoutes", "createdBy", "benchmarkRunId", "settings"],
      properties: {
        report: {
          allOf: [
            {
              $ref: "#/$defs/optimizeReportView"
            },
            {
              type: "object",
              properties: {
                run: {
                  type: "object",
                  properties: {
                    objective: {
                      const: "latency"
                    }
                  }
                }
              }
            }
          ]
        },
        candidateRoutes: {
          type: "array",
          items: {
            $ref: "#/$defs/optimizeCandidateRoute"
          }
        },
        requestedRoutes: {
          anyOf: [
            {
              type: "array",
              items: {
                type: "string",
                minLength: 1
              }
            },
            {
              type: "null"
            }
          ]
        },
        createdBy: {
          type: "string",
          minLength: 1
        },
        benchmarkRunId: {
          type: "string",
          minLength: 1
        },
        settings: {
          type: "object"
        },
        runId: {
          type: "string",
          minLength: 1
        }
      }
    },
    traceListRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "trace.list"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/traceListPayload"
        }
      }
    },
    traceListObservationsRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "trace.listObservations"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/traceListObservationsPayload"
        }
      }
    },
    traceGetStatsRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "trace.getStats"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/traceGetStatsPayload"
        }
      }
    },
    traceShowRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "trace.show"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/traceShowPayload"
        }
      }
    },
    ledgerListRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "ledger.list"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/ledgerListPayload"
        }
      }
    },
    ledgerShowRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "ledger.show"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/ledgerShowPayload"
        }
      }
    },
    retentionPruneOlderThanRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "retention.pruneOlderThan"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/retentionPruneOlderThanPayload"
        }
      }
    },
    benchmarkHistoryListRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "benchmarkHistory.list"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/benchmarkHistoryListPayload"
        }
      }
    },
    benchmarkHistoryShowRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "benchmarkHistory.show"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/benchmarkHistoryShowPayload"
        }
      }
    },
    benchmarkHistoryPruneOlderThanRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "benchmarkHistory.pruneOlderThan"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/benchmarkHistoryPruneOlderThanPayload"
        }
      }
    },
    benchmarkHistoryDeleteRunRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "benchmarkHistory.deleteRun"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/benchmarkHistoryDeleteRunPayload"
        }
      }
    },
    benchmarkHistoryClearRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "benchmarkHistory.clear"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/benchmarkHistoryClearPayload"
        }
      }
    },
    benchmarkRunsRunRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "benchmarkRuns.run"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/benchmarkRunsRunPayload"
        }
      }
    },
    optimizationHistoryListRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "optimizationHistory.list"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/optimizationHistoryListPayload"
        }
      }
    },
    optimizationHistoryShowRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "optimizationHistory.show"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/optimizationHistoryShowPayload"
        }
      }
    },
    optimizationHistoryPruneOlderThanRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "optimizationHistory.pruneOlderThan"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/optimizationHistoryPruneOlderThanPayload"
        }
      }
    },
    optimizationHistoryDeleteRunRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "optimizationHistory.deleteRun"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/optimizationHistoryDeleteRunPayload"
        }
      }
    },
    optimizationHistoryClearRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "optimizationHistory.clear"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/optimizationHistoryClearPayload"
        }
      }
    },
    optimizationReportsPersistCostRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "optimizationReports.persistCost"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/optimizationReportsPersistCostPayload"
        }
      }
    },
    optimizationReportsPersistLatencyRequest: {
      type: "object",
      additionalProperties: false,
      required: ["id", "operation", "contract_version", "store", "payload"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        operation: {
          const: "optimizationReports.persistLatency"
        },
        contract_version: {
          $ref: "#/$defs/contractVersion"
        },
        store: {
          $ref: "#/$defs/storeRef"
        },
        payload: {
          $ref: "#/$defs/optimizationReportsPersistLatencyPayload"
        }
      }
    },
    requestExecutionRecord: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "request_id",
        "started_at",
        "completed_at",
        "request_received_at",
        "route_resolved_at",
        "upstream_request_started_at",
        "upstream_response_started_at",
        "upstream_response_completed_at",
        "client_response_started_at",
        "client_response_completed_at",
        "route_id",
        "route_name",
        "model_id",
        "provider_id",
        "provider_model_id",
        "client_api_mode",
        "upstream_api_mode",
        "status_code",
        "outcome",
        "failure_stage",
        "failure_reason",
        "observation_count",
        "latency_ms",
        "ttft_ms",
        "duration_ms",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "estimated_cost_micros",
        "currency",
        "switchmaxxer_pre_upstream_ms",
        "upstream_ttft_ms",
        "upstream_duration_ms",
        "switchmaxxer_post_upstream_ms",
        "client_write_ms",
        "gateway_residency_ms",
        "partial_output"
      ],
      properties: {
        id: { type: "string", minLength: 1 },
        request_id: { type: "string", minLength: 1 },
        started_at: { type: "string", minLength: 1 },
        completed_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        request_received_at: { type: "string", minLength: 1 },
        route_resolved_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        upstream_request_started_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        upstream_response_started_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        upstream_response_completed_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        client_response_started_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        client_response_completed_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        route_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        route_name: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        model_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        provider_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        provider_model_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        client_api_mode: { type: "string", minLength: 1 },
        upstream_api_mode: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        status_code: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        outcome: { type: "string", minLength: 1 },
        failure_stage: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        failure_reason: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        observation_count: { type: "integer", minimum: 0 },
        latency_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        ttft_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        duration_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        input_tokens: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        output_tokens: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        total_tokens: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        estimated_cost_micros: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        currency: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        switchmaxxer_pre_upstream_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        upstream_ttft_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        upstream_duration_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        switchmaxxer_post_upstream_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        client_write_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        gateway_residency_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        partial_output: { enum: [0, 1] }
      }
    },
    traceListResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "traces"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        traces: {
          type: "array",
          items: {
            $ref: "#/$defs/requestExecutionRecord"
          }
        }
      }
    },
    observationRecord: {
      type: "object",
      additionalProperties: false,
      required: ["id", "observed_at", "surface", "kind", "event"],
      properties: {
        id: { type: "string", minLength: 1 },
        observed_at: { type: "string", minLength: 1 },
        ingested_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        request_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        trace_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        span_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        parent_span_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        surface: { type: "string", minLength: 1 },
        kind: { type: "string", minLength: 1 },
        event: { type: "string", minLength: 1 },
        stage: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        severity: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        outcome: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        route_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        route_name: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        model_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        provider_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        provider_model_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        client_api_mode: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        upstream_api_mode: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        listener: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        actor: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        status_code: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        latency_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        ttft_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        duration_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        request_bytes: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        response_bytes: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        input_tokens: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        output_tokens: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        total_tokens: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        estimated_cost_micros: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        currency: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        billing_source: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        benchmark_run_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        benchmark_case_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        optimization_profile_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        tags_json: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        attributes_json: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        attributes_truncated: { type: "integer", minimum: 0 },
        message: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] }
      }
    },
    traceListObservationsResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "observations"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        observations: {
          type: "array",
          items: {
            $ref: "#/$defs/observationRecord"
          }
        }
      }
    },
    traceStatsOutcomeCount: {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "count"],
      properties: {
        outcome: {
          type: "string",
          minLength: 1
        },
        count: {
          type: "integer",
          minimum: 0
        }
      }
    },
    traceStatsTopFailingRoute: {
      type: "object",
      additionalProperties: false,
      required: ["route", "count"],
      properties: {
        route: {
          type: "string",
          minLength: 1
        },
        count: {
          type: "integer",
          minimum: 0
        }
      }
    },
    traceStatsRecord: {
      type: "object",
      additionalProperties: false,
      required: [
        "total_count",
        "partial_output_count",
        "average_gateway_residency_ms",
        "average_upstream_ttft_ms",
        "average_upstream_duration_ms",
        "outcome_counts",
        "top_failing_routes"
      ],
      properties: {
        total_count: { type: "integer", minimum: 0 },
        partial_output_count: { type: "integer", minimum: 0 },
        average_gateway_residency_ms: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        average_upstream_ttft_ms: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        average_upstream_duration_ms: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        outcome_counts: {
          type: "array",
          items: {
            $ref: "#/$defs/traceStatsOutcomeCount"
          }
        },
        top_failing_routes: {
          type: "array",
          items: {
            $ref: "#/$defs/traceStatsTopFailingRoute"
          }
        }
      }
    },
    traceGetStatsResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "stats"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        stats: {
          $ref: "#/$defs/traceStatsRecord"
        }
      }
    },
    benchmarkSampleRecord: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "benchmark_run_id",
        "request_execution_id",
        "route_id",
        "provider_id",
        "provider_model_id",
        "sample_index",
        "started_at",
        "completed_at",
        "status_code",
        "outcome",
        "latency_ms",
        "ttft_ms",
        "duration_ms",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "estimated_cost_micros",
        "is_warmup",
        "score_value",
        "score_scale",
        "score_direction",
        "score_source",
        "score_method",
        "scored_at",
        "score_json"
      ],
      properties: {
        id: { type: "string", minLength: 1 },
        benchmark_run_id: { type: "string", minLength: 1 },
        request_execution_id: { type: "string", minLength: 1 },
        route_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        provider_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        provider_model_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        sample_index: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        started_at: { type: "string", minLength: 1 },
        completed_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        status_code: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        outcome: { type: "string", minLength: 1 },
        latency_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        ttft_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        duration_ms: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        input_tokens: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        output_tokens: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        total_tokens: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        estimated_cost_micros: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        is_warmup: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        score_value: { anyOf: [{ type: "number" }, { type: "null" }] },
        score_scale: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        score_direction: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        score_source: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        score_method: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        scored_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        score_json: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] }
      }
    },
    benchmarkRunRecord: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "created_at", "created_by", "objective", "notes", "settings_json", "status"],
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        created_at: { type: "string", minLength: 1 },
        created_by: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        objective: { type: "string", minLength: 1 },
        notes: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        settings_json: { type: "string", minLength: 1 },
        status: { type: "string", minLength: 1 }
      }
    },
    benchmarkRunSummary: {
      type: "object",
      additionalProperties: false,
      required: [
        "total_samples",
        "measured_samples",
        "warmup_samples",
        "success_count",
        "failed_count",
        "average_latency_ms",
        "min_latency_ms",
        "max_latency_ms",
        "average_ttft_ms",
        "average_duration_ms"
      ],
      properties: {
        total_samples: { type: "integer", minimum: 0 },
        measured_samples: { type: "integer", minimum: 0 },
        warmup_samples: { type: "integer", minimum: 0 },
        success_count: { type: "integer", minimum: 0 },
        failed_count: { type: "integer", minimum: 0 },
        average_latency_ms: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        min_latency_ms: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        max_latency_ms: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        average_ttft_ms: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        average_duration_ms: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] }
      }
    },
    benchmarkHistoryListItem: {
      type: "object",
      additionalProperties: false,
      required: ["run", "summary"],
      properties: {
        run: {
          $ref: "#/$defs/benchmarkRunRecord"
        },
        summary: {
          $ref: "#/$defs/benchmarkRunSummary"
        }
      }
    },
    traceShowResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "requestExecution", "observations", "benchmarkSamples"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        requestExecution: {
          anyOf: [
            {
              $ref: "#/$defs/requestExecutionRecord"
            },
            {
              type: "null"
            }
          ]
        },
        observations: {
          type: "array",
          items: {
            $ref: "#/$defs/observationRecord"
          }
        },
        benchmarkSamples: {
          type: "array",
          items: {
            $ref: "#/$defs/benchmarkSampleRecord"
          }
        }
      }
    },
    controlPlaneActionEventRecord: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "created_at",
        "finished_at",
        "created_by",
        "source_surface",
        "actor_kind",
        "actor_id",
        "session_id",
        "operation",
        "status",
        "target_kind",
        "target_id",
        "optimization_run_id",
        "mutation_event_id",
        "correlation_ids_json",
        "result_json",
        "error_json",
        "metadata_json"
      ],
      properties: {
        id: { type: "string", minLength: 1 },
        created_at: { type: "string", minLength: 1 },
        finished_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        created_by: { type: "string", minLength: 1 },
        source_surface: { type: "string", minLength: 1 },
        actor_kind: { type: "string", minLength: 1 },
        actor_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        session_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        operation: { type: "string", minLength: 1 },
        status: { type: "string", minLength: 1 },
        target_kind: { type: "string", minLength: 1 },
        target_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        optimization_run_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        mutation_event_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        correlation_ids_json: { type: "string", minLength: 1 },
        result_json: { type: "string", minLength: 1 },
        error_json: { type: "string", minLength: 1 },
        metadata_json: { type: "string", minLength: 1 }
      }
    },
    ledgerListResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "events"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        events: {
          type: "array",
          items: {
            $ref: "#/$defs/controlPlaneActionEventRecord"
          }
        }
      }
    },
    ledgerShowResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "event"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        event: {
          anyOf: [
            {
              $ref: "#/$defs/controlPlaneActionEventRecord"
            },
            {
              type: "null"
            }
          ]
        }
      }
    },
    retentionPruneCounts: {
      type: "object",
      additionalProperties: false,
      required: [
        "status",
        "cutoff_at",
        "failure_stage",
        "failure_message",
        "observations_deleted",
        "request_executions_deleted",
        "benchmark_runs_deleted",
        "benchmark_samples_deleted",
        "cost_facts_deleted",
        "optimization_facts_deleted",
        "control_plane_action_events_deleted",
        "config_mutation_events_deleted",
        "config_snapshots_deleted",
        "total_deleted"
      ],
      properties: {
        status: {
          type: "string",
          minLength: 1
        },
        cutoff_at: {
          type: "string",
          minLength: 1
        },
        failure_stage: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        failure_message: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        observations_deleted: { type: "integer", minimum: 0 },
        request_executions_deleted: { type: "integer", minimum: 0 },
        benchmark_runs_deleted: { type: "integer", minimum: 0 },
        benchmark_samples_deleted: { type: "integer", minimum: 0 },
        cost_facts_deleted: { type: "integer", minimum: 0 },
        optimization_facts_deleted: { type: "integer", minimum: 0 },
        control_plane_action_events_deleted: { type: "integer", minimum: 0 },
        config_mutation_events_deleted: { type: "integer", minimum: 0 },
        config_snapshots_deleted: { type: "integer", minimum: 0 },
        total_deleted: { type: "integer", minimum: 0 }
      }
    },
    retentionPruneOlderThanResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "result"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        result: {
          anyOf: [
            {
              $ref: "#/$defs/retentionPruneCounts"
            },
            {
              type: "null"
            }
          ]
        }
      }
    },
    benchmarkHistoryListResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "runs"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        runs: {
          type: "array",
          items: {
            $ref: "#/$defs/benchmarkHistoryListItem"
          }
        }
      }
    },
    benchmarkHistoryShowResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "run", "summary", "samples"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        run: {
          anyOf: [
            {
              $ref: "#/$defs/benchmarkRunRecord"
            },
            {
              type: "null"
            }
          ]
        },
        summary: {
          anyOf: [
            {
              $ref: "#/$defs/benchmarkRunSummary"
            },
            {
              type: "null"
            }
          ]
        },
        samples: {
          type: "array",
          items: {
            $ref: "#/$defs/benchmarkSampleRecord"
          }
        }
      }
    },
    benchmarkHistoryDeleteCounts: {
      type: "object",
      additionalProperties: false,
      required: ["benchmark_runs_deleted", "benchmark_samples_deleted", "total_deleted"],
      properties: {
        benchmark_runs_deleted: {
          type: "integer",
          minimum: 0
        },
        benchmark_samples_deleted: {
          type: "integer",
          minimum: 0
        },
        total_deleted: {
          type: "integer",
          minimum: 0
        }
      }
    },
    benchmarkHistoryDeleteResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "result"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        result: {
          anyOf: [
            {
              $ref: "#/$defs/benchmarkHistoryDeleteCounts"
            },
            {
              type: "null"
            }
          ]
        }
      }
    },
    benchmarkReportView: {
      type: "object",
      additionalProperties: false,
      required: ["run", "execution", "summary", "analysis", "samples"],
      properties: {
        store_path: {
          type: "string",
          minLength: 1
        },
        run: {
          type: "object"
        },
        execution: {
          type: "object"
        },
        summary: {
          $ref: "#/$defs/benchmarkRunSummary"
        },
        analysis: {
          type: "object",
          required: ["by_path"],
          properties: {
            by_path: {
              type: "array",
              items: {
                type: "object"
              }
            }
          }
        },
        samples: {
          type: "array",
          items: {
            type: "object"
          }
        }
      }
    },
    benchmarkRunnerFailure: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "code", "message"],
      properties: {
        kind: {
          type: "string",
          minLength: 1
        },
        code: {
          type: "string",
          minLength: 1
        },
        message: {
          type: "string",
          minLength: 1
        },
        details: {
          type: "object"
        }
      }
    },
    benchmarkRunnerSuccessResult: {
      type: "object",
      additionalProperties: false,
      required: ["ok", "benchmarkRunId", "run", "summary", "samples", "sampleViews", "report"],
      properties: {
        ok: {
          const: true
        },
        benchmarkRunId: {
          type: "string",
          minLength: 1
        },
        run: {
          $ref: "#/$defs/benchmarkRunRecord"
        },
        summary: {
          $ref: "#/$defs/benchmarkRunSummary"
        },
        samples: {
          type: "array",
          items: {
            $ref: "#/$defs/benchmarkSampleRecord"
          }
        },
        sampleViews: {
          type: "array",
          items: {
            type: "object"
          }
        },
        report: {
          $ref: "#/$defs/benchmarkReportView"
        }
      }
    },
    benchmarkRunnerFailureResult: {
      type: "object",
      additionalProperties: false,
      required: ["ok", "failure"],
      properties: {
        ok: {
          const: false
        },
        failure: {
          $ref: "#/$defs/benchmarkRunnerFailure"
        }
      }
    },
    benchmarkRunsRunResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "result"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        result: {
          anyOf: [
            {
              $ref: "#/$defs/benchmarkRunnerSuccessResult"
            },
            {
              $ref: "#/$defs/benchmarkRunnerFailureResult"
            },
            {
              type: "null"
            }
          ]
        }
      }
    },
    optimizationRunRecord: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "created_at",
        "finished_at",
        "created_by",
        "target_model",
        "objective",
        "status",
        "winner_route",
        "benchmark_run_id",
        "settings_json",
        "candidate_snapshot_json",
        "result_json",
        "warnings_json"
      ],
      properties: {
        id: { type: "string", minLength: 1 },
        created_at: { type: "string", minLength: 1 },
        finished_at: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        created_by: { type: "string", minLength: 1 },
        target_model: { type: "string", minLength: 1 },
        objective: { type: "string", minLength: 1 },
        status: { type: "string", minLength: 1 },
        winner_route: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        benchmark_run_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        settings_json: { type: "string", minLength: 1 },
        candidate_snapshot_json: { type: "string", minLength: 1 },
        result_json: { type: "string", minLength: 1 },
        warnings_json: { type: "string", minLength: 1 }
      }
    },
    optimizationHistoryListResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "runs"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        runs: {
          type: "array",
          items: {
            $ref: "#/$defs/optimizationRunRecord"
          }
        }
      }
    },
    optimizationHistoryShowResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "run"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        run: {
          anyOf: [
            {
              $ref: "#/$defs/optimizationRunRecord"
            },
            {
              type: "null"
            }
          ]
        }
      }
    },
    optimizationHistoryDeleteCounts: {
      type: "object",
      additionalProperties: false,
      required: [
        "optimization_runs_deleted",
        "config_mutation_events_deleted",
        "config_snapshots_deleted",
        "total_deleted"
      ],
      properties: {
        optimization_runs_deleted: {
          type: "integer",
          minimum: 0
        },
        config_mutation_events_deleted: {
          type: "integer",
          minimum: 0
        },
        config_snapshots_deleted: {
          type: "integer",
          minimum: 0
        },
        total_deleted: {
          type: "integer",
          minimum: 0
        }
      }
    },
    optimizationHistoryDeleteResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "result"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        result: {
          anyOf: [
            {
              $ref: "#/$defs/optimizationHistoryDeleteCounts"
            },
            {
              type: "null"
            }
          ]
        }
      }
    },
    optimizeReportRun: {
      type: "object",
      additionalProperties: false,
      required: ["run_id", "persisted", "created_at", "finished_at", "created_by", "status", "target_model", "objective"],
      properties: {
        run_id: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        persisted: {
          type: "boolean"
        },
        created_at: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        finished_at: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        created_by: {
          anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
        },
        status: {
          type: "string",
          minLength: 1
        },
        target_model: {
          type: "string",
          minLength: 1
        },
        objective: {
          enum: ["cost", "latency"]
        }
      }
    },
    optimizeReportDisqualifiedCandidate: {
      type: "object",
      additionalProperties: false,
      required: ["route_id", "reason", "message"],
      properties: {
        route_id: {
          type: "string",
          minLength: 1
        },
        reason: {
          type: "string",
          minLength: 1
        },
        message: {
          type: "string",
          minLength: 1
        }
      }
    },
    optimizeReportCandidates: {
      type: "object",
      additionalProperties: false,
      required: ["requested_routes", "resolved_routes", "disqualified"],
      properties: {
        requested_routes: {
          anyOf: [
            {
              type: "array",
              items: {
                type: "string",
                minLength: 1
              }
            },
            {
              type: "null"
            }
          ]
        },
        resolved_routes: {
          type: "array",
          items: {
            type: "string",
            minLength: 1
          }
        },
        disqualified: {
          type: "array",
          items: {
            $ref: "#/$defs/optimizeReportDisqualifiedCandidate"
          }
        }
      }
    },
    optimizeReportBench: {
      type: "object",
      additionalProperties: false,
      required: ["run_id", "summary", "execution"],
      properties: {
        run_id: {
          type: "string",
          minLength: 1
        },
        summary: {
          $ref: "#/$defs/benchmarkRunSummary"
        },
        execution: {
          type: "object"
        }
      }
    },
    optimizeRankingEntry: {
      type: "object",
      additionalProperties: false,
      required: ["route_id", "score"],
      properties: {
        route_id: {
          type: "string",
          minLength: 1
        },
        score: {
          type: "number"
        }
      }
    },
    optimizeReportWinner: {
      type: "object",
      additionalProperties: false,
      required: ["route_id", "score", "score_unit", "tied_with"],
      properties: {
        route_id: {
          type: "string",
          minLength: 1
        },
        score: {
          type: "number"
        },
        score_unit: {
          enum: ["usd", "ms"]
        },
        tied_with: {
          type: "array",
          items: {
            type: "string",
            minLength: 1
          }
        }
      }
    },
    optimizeWarning: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: {
        code: {
          type: "string",
          minLength: 1
        },
        message: {
          type: "string",
          minLength: 1
        }
      }
    },
    optimizeReportView: {
      type: "object",
      additionalProperties: false,
      required: ["run", "candidates", "reference_tokens", "bench", "ranking", "winner", "warnings"],
      properties: {
        store_path: {
          type: "string",
          minLength: 1
        },
        run: {
          $ref: "#/$defs/optimizeReportRun"
        },
        candidates: {
          $ref: "#/$defs/optimizeReportCandidates"
        },
        reference_tokens: {
          $ref: "#/$defs/optimizeReferenceTokens"
        },
        bench: {
          anyOf: [
            {
              $ref: "#/$defs/optimizeReportBench"
            },
            {
              type: "null"
            }
          ]
        },
        ranking: {
          type: "array",
          items: {
            $ref: "#/$defs/optimizeRankingEntry"
          }
        },
        winner: {
          $ref: "#/$defs/optimizeReportWinner"
        },
        warnings: {
          type: "array",
          items: {
            $ref: "#/$defs/optimizeWarning"
          }
        }
      }
    },
    optimizationReportsPersistResult: {
      type: "object",
      additionalProperties: false,
      required: ["dbPath", "storeFound", "report"],
      properties: {
        dbPath: {
          type: "string",
          minLength: 1
        },
        storeFound: {
          type: "boolean"
        },
        report: {
          anyOf: [
            {
              $ref: "#/$defs/optimizeReportView"
            },
            {
              type: "null"
            }
          ]
        }
      }
    },
    traceListSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/traceListResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    traceListObservationsSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/traceListObservationsResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    traceGetStatsSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/traceGetStatsResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    traceShowSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/traceShowResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    ledgerListSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/ledgerListResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    ledgerShowSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/ledgerShowResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    retentionPruneOlderThanSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/retentionPruneOlderThanResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    benchmarkRunsRunSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/benchmarkRunsRunResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    benchmarkHistoryListSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/benchmarkHistoryListResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    benchmarkHistoryShowSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/benchmarkHistoryShowResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    benchmarkHistoryPruneOlderThanSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/benchmarkHistoryDeleteResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    benchmarkHistoryDeleteRunSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/benchmarkHistoryDeleteResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    benchmarkHistoryClearSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/benchmarkHistoryDeleteResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    optimizationHistoryListSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/optimizationHistoryListResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    optimizationHistoryShowSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/optimizationHistoryShowResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    optimizationHistoryPruneOlderThanSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/optimizationHistoryDeleteResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    optimizationHistoryDeleteRunSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/optimizationHistoryDeleteResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    optimizationHistoryClearSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/optimizationHistoryDeleteResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    optimizationReportsPersistCostSuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/optimizationReportsPersistResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    },
    optimizationReportsPersistLatencySuccessResponse: {
      type: "object",
      additionalProperties: false,
      required: ["id", "ok", "result", "warnings"],
      properties: {
        id: {
          type: "string",
          minLength: 1
        },
        ok: {
          const: true
        },
        result: {
          $ref: "#/$defs/optimizationReportsPersistResult"
        },
        warnings: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    }
  },
  anyOf: [
    {
      $ref: "#/$defs/externalOptimizeApplyCommand"
    },
    {
      $ref: "#/$defs/externalOptimizeRestoreCommand"
    },
    {
      $ref: "#/$defs/traceListRequest"
    },
    {
      $ref: "#/$defs/traceListObservationsRequest"
    },
    {
      $ref: "#/$defs/traceGetStatsRequest"
    },
    {
      $ref: "#/$defs/traceShowRequest"
    },
    {
      $ref: "#/$defs/ledgerListRequest"
    },
    {
      $ref: "#/$defs/ledgerShowRequest"
    },
    {
      $ref: "#/$defs/retentionPruneOlderThanRequest"
    },
    {
      $ref: "#/$defs/benchmarkHistoryListRequest"
    },
    {
      $ref: "#/$defs/benchmarkHistoryShowRequest"
    },
    {
      $ref: "#/$defs/benchmarkHistoryPruneOlderThanRequest"
    },
    {
      $ref: "#/$defs/benchmarkHistoryDeleteRunRequest"
    },
    {
      $ref: "#/$defs/benchmarkHistoryClearRequest"
    },
    {
      $ref: "#/$defs/benchmarkRunsRunRequest"
    },
    {
      $ref: "#/$defs/optimizationHistoryListRequest"
    },
    {
      $ref: "#/$defs/optimizationHistoryShowRequest"
    },
    {
      $ref: "#/$defs/optimizationHistoryPruneOlderThanRequest"
    },
    {
      $ref: "#/$defs/optimizationHistoryDeleteRunRequest"
    },
    {
      $ref: "#/$defs/optimizationHistoryClearRequest"
    },
    {
      $ref: "#/$defs/optimizationReportsPersistCostRequest"
    },
    {
      $ref: "#/$defs/optimizationReportsPersistLatencyRequest"
    },
    {
      $ref: "#/$defs/traceListSuccessResponse"
    },
    {
      $ref: "#/$defs/traceListObservationsSuccessResponse"
    },
    {
      $ref: "#/$defs/traceGetStatsSuccessResponse"
    },
    {
      $ref: "#/$defs/traceShowSuccessResponse"
    },
    {
      $ref: "#/$defs/ledgerListSuccessResponse"
    },
    {
      $ref: "#/$defs/ledgerShowSuccessResponse"
    },
    {
      $ref: "#/$defs/retentionPruneOlderThanSuccessResponse"
    },
    {
      $ref: "#/$defs/benchmarkRunsRunSuccessResponse"
    },
    {
      $ref: "#/$defs/benchmarkHistoryListSuccessResponse"
    },
    {
      $ref: "#/$defs/benchmarkHistoryShowSuccessResponse"
    },
    {
      $ref: "#/$defs/benchmarkHistoryPruneOlderThanSuccessResponse"
    },
    {
      $ref: "#/$defs/benchmarkHistoryDeleteRunSuccessResponse"
    },
    {
      $ref: "#/$defs/benchmarkHistoryClearSuccessResponse"
    },
    {
      $ref: "#/$defs/optimizationHistoryListSuccessResponse"
    },
    {
      $ref: "#/$defs/optimizationHistoryShowSuccessResponse"
    },
    {
      $ref: "#/$defs/optimizationHistoryPruneOlderThanSuccessResponse"
    },
    {
      $ref: "#/$defs/optimizationHistoryDeleteRunSuccessResponse"
    },
    {
      $ref: "#/$defs/optimizationHistoryClearSuccessResponse"
    },
    {
      $ref: "#/$defs/optimizationReportsPersistCostSuccessResponse"
    },
    {
      $ref: "#/$defs/optimizationReportsPersistLatencySuccessResponse"
    }
  ]
};

const readme = `# Observability IPC Schemas

This directory contains generated schema artifacts for the observability
IPC boundary.

Authoritative TypeScript sources:

- \`src/subsystems/observability/observability-ipc-contract.ts\`
- \`src/subsystems/observability/observability-module.ts\`
- \`src/subsystems/observability/observability-ipc-validation.ts\`
- \`src/subsystems/observability/observability-ipc-result-validation.ts\`

Generate or check the artifacts with:

\`\`\`sh
npm run check:observability-ipc-schema
\`\`\`

Manual edits to \`observability-ipc.schema.json\` will be overwritten by
\`scripts/generate-observability-ipc-schema.js\`.

Initial operation-frame schema coverage is intentionally narrow: trace
read, Ledger read, retention prune, benchmark run, benchmark history,
optimization history, and optimization report persistence request and
success-response frames only.

The same artifact also publishes standalone JSON-safe external optimize
mutation command schemas for future apply/restore transport work. Those
commands are not operation-frame schemas and external apply/restore
dispatch remains disabled until the runtime mapping and idempotency
contract are settled.
`;

const schemaOutput = JSON.stringify(schema, null, 2) + "\n";

if (checkOnly) {
  assertFile(schemaPath, schemaOutput);
  assertFile(readmePath, readme);
} else {
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(schemaPath, schemaOutput);
  writeFileSync(readmePath, readme);
}

function assertFile(filePath, expected) {
  let actual;
  try {
    actual = readFileSync(filePath, "utf8");
  } catch {
    process.stderr.write(`Generated observability IPC artifact is missing: ${relative(filePath)}\n`);
    process.exit(1);
  }

  if (actual !== expected) {
    process.stderr.write(
      `Generated observability IPC artifact is stale: ${relative(filePath)}\n` +
        "Run `node scripts/generate-observability-ipc-schema.js` and commit the result.\n"
    );
    process.exit(1);
  }
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}
