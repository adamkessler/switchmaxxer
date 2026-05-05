import { sanitizeErrorDetails } from "./error-detail-sanitizer";

export const CLI_SCHEMA_VERSION = "1";

export type SuccessEnvelopeOptions = {
  count?: number;
  warnings?: unknown;
  details?: unknown;
  normalized_fields?: Array<{
    field: string;
    input: unknown;
    stored: unknown;
  }>;
  top_level?: Record<string, unknown>;
  editability?: {
    writable: string[];
    derived: string[];
    effective: string[];
  };
};

export type SuccessEnvelope = {
  ok: true;
  command: string;
  schema_version: string;
  data: unknown;
  count?: number;
  warnings?: unknown;
  details?: unknown;
  normalized_fields?: Array<{
    field: string;
    input: unknown;
    stored: unknown;
  }>;
  editability?: {
    writable: string[];
    derived: string[];
    effective: string[];
  };
} & Record<string, unknown>;

export type ErrorEnvelope<Code extends string = string> = {
  ok: false;
  command: string;
  schema_version: string;
  error: {
    code: Code;
    message: string;
  };
  warnings?: unknown;
  details?: unknown;
};

export type ErrorEnvelopeOptions = {
  warnings?: unknown;
  details?: unknown;
};

const RESERVED_SUCCESS_ENVELOPE_TOP_LEVEL_KEYS = new Set([
  "ok",
  "command",
  "schema_version",
  "data",
  "count",
  "warnings",
  "details",
  "normalized_fields",
  "editability",
  "error"
]);

export function buildSuccessEnvelope(
  command: string,
  data: unknown,
  options: SuccessEnvelopeOptions = {}
): SuccessEnvelope {
  if (typeof options.top_level !== "undefined") {
    for (const key of Object.keys(options.top_level)) {
      if (RESERVED_SUCCESS_ENVELOPE_TOP_LEVEL_KEYS.has(key)) {
        throw new Error(`Success envelope top_level must not override reserved field '${key}'.`);
      }
    }
  }

  return {
    ok: true,
    command,
    schema_version: CLI_SCHEMA_VERSION,
    data,
    ...(typeof options.count === "undefined" ? {} : { count: options.count }),
    ...(typeof options.warnings === "undefined" ? {} : { warnings: options.warnings }),
    ...(typeof options.details === "undefined" ? {} : { details: options.details }),
    ...(typeof options.normalized_fields === "undefined" ? {} : { normalized_fields: options.normalized_fields }),
    ...(typeof options.top_level === "undefined" ? {} : options.top_level),
    ...(typeof options.editability === "undefined" ? {} : { editability: options.editability })
  };
}

export function buildErrorEnvelope<Code extends string>(
  command: string,
  code: Code,
  message: string,
  options: ErrorEnvelopeOptions = {}
): ErrorEnvelope<Code> {
  return {
    ok: false,
    command,
    schema_version: CLI_SCHEMA_VERSION,
    error: {
      code,
      message
    },
    ...(typeof options.warnings === "undefined" ? {} : { warnings: options.warnings }),
    ...(typeof options.details === "undefined" ? {} : { details: options.details })
  };
}

export function buildSanitizedErrorEnvelope<Code extends string>(
  command: string,
  code: Code,
  message: string,
  options: ErrorEnvelopeOptions = {}
): ErrorEnvelope<Code> {
  return buildErrorEnvelope(command, code, message, {
    warnings: options.warnings,
    details: sanitizeErrorDetails(options.details)
  });
}
