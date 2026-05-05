#!/usr/bin/env node

const fs = require("node:fs");
const Ajv = require("ajv");

require("ts-node/register/transpile-only");

const { getContractSourcePaths } = require("./lib/contract-source-paths.js");
const {
  CLI_SCHEMA_VERSION,
  buildErrorEnvelope,
  buildSuccessEnvelope
} = require("../src/platform/response-envelope.ts");
const { APP_ERROR_CODES } = require("../src/platform/error-codes.ts");
const {
  MCP_USAGE_ERROR_CODES,
  MCP_ENTITY_STATE_ERROR_CODES
} = require("../src/subsystems/config/config-metadata.ts");

function readAppErrorCodes() {
  return new Set([
    ...Object.values(APP_ERROR_CODES),
    ...Object.values(MCP_USAGE_ERROR_CODES),
    ...Object.values(MCP_ENTITY_STATE_ERROR_CODES)
  ]);
}

async function readStdin() {
  let raw = "";

  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  return raw;
}

function assertCanonicalContractSourcesExist() {
  const sourcePaths = getContractSourcePaths();
  const requiredPaths = [
    sourcePaths.platform.responseEnvelope,
    sourcePaths.platform.errorCodes,
    sourcePaths.subsystems.configMetadata,
    sourcePaths.subsystems.gatewayRoot,
    sourcePaths.subsystems.proxyRoot
  ];

  for (const requiredPath of requiredPaths) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Canonical contract source path is missing: ${requiredPath}`);
    }
  }
}

function buildSelfTestPayloads() {
  return [
    buildSuccessEnvelope("self-test success", { ok: true }),
    buildErrorEnvelope("self-test error", APP_ERROR_CODES.invalidRequest, "self-test error")
  ];
}

function validateEnvelope(parsed, cliSchemaVersion, appErrorCodes, validate) {
  if (!validate(parsed)) {
    const issues = (validate.errors ?? []).map((entry) => `${entry.instancePath || "/"} ${entry.message ?? "invalid"}`);
    throw new Error(`CLI envelope schema validation failed: ${issues.join("; ")}`);
  }

  if (parsed.ok === false && typeof parsed.error?.code === "string" && !appErrorCodes.has(parsed.error.code)) {
    throw new Error(`CLI envelope error.code is not in APP_ERROR_CODES: ${parsed.error.code}`);
  }
}

async function main() {
  assertCanonicalContractSourcesExist();
  const cliSchemaVersion = CLI_SCHEMA_VERSION;
  const appErrorCodes = readAppErrorCodes();

  const ajv = new Ajv({
    allErrors: true,
    strict: false
  });

  const schema = {
    type: "object",
    required: ["ok", "command", "schema_version"],
    properties: {
      ok: { type: "boolean" },
      command: { type: "string", minLength: 1 },
      schema_version: { const: cliSchemaVersion },
      data: true,
      count: { type: "integer" },
      warnings: true,
      details: true,
      normalized_fields: {
        type: "array",
        items: {
          type: "object",
          required: ["field", "input", "stored"],
          properties: {
            field: { type: "string", minLength: 1 },
            input: true,
            stored: true
          },
          additionalProperties: false
        }
      },
      editability: {
        type: "object",
        required: ["writable", "derived", "effective"],
        properties: {
          writable: {
            type: "array",
            items: { type: "string", minLength: 1 }
          },
          derived: {
            type: "array",
            items: { type: "string", minLength: 1 }
          },
          effective: {
            type: "array",
            items: { type: "string", minLength: 1 }
          }
        },
        additionalProperties: false
      },
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string", minLength: 1 },
          message: { type: "string", minLength: 1 }
        },
        additionalProperties: false
      }
    },
    allOf: [
      {
        if: {
          properties: {
            ok: { const: true }
          },
          required: ["ok"]
        },
        then: {
          required: ["data"]
        }
      },
      {
        if: {
          properties: {
            ok: { const: false }
          },
          required: ["ok"]
        },
        then: {
          required: ["error"]
        }
      }
    ],
    additionalProperties: true
  };

  const validate = ajv.compile(schema);

  if (process.argv.includes("--self-test")) {
    for (const payload of buildSelfTestPayloads()) {
      validateEnvelope(payload, cliSchemaVersion, appErrorCodes, validate);
    }

    process.stdout.write("CLI envelope validator self-test passed.\n");
    return;
  }

  const raw = await readStdin();
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`CLI output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  validateEnvelope(parsed, cliSchemaVersion, appErrorCodes, validate);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
