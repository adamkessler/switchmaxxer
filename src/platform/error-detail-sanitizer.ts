import { redactSensitiveText } from "./logger";
import { isRecord } from "./type-guards";

const MAX_ERROR_DETAIL_DEPTH = 5;
const ERROR_DETAIL_TRUNCATED_MARKER = Object.freeze({ truncated: true });
const ERROR_DETAIL_PUBLIC_METADATA_KEYS = new Set([
  "allow_unauthenticated_gateway",
  "anthropic_version",
  "api_key_env",
  "api_key_masked",
  "auth_mode",
  "authentication_scheme",
  "auth_source",
  "inbound_api_key_env",
  "no_auth",
  "one_trusted_operator_boundary"
]);
const ERROR_DETAIL_SENSITIVE_EXACT_KEYS = new Set([
  "api_key",
  "auth_header",
  "auth_token",
  "authorization",
  "bearer_token",
  "client_secret",
  "inline_api_key",
  "inbound_api_key",
  "password",
  "refresh_token",
  "secret",
  "session_token",
  "sessiontoken",
  "token"
]);
const ERROR_DETAIL_SENSITIVE_SUFFIXES = ["_api_key", "_password", "_secret", "_token"];

function normalizeErrorDetailKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isSensitiveErrorDetailKey(key: string): boolean {
  const normalizedKey = normalizeErrorDetailKey(key);

  if (ERROR_DETAIL_PUBLIC_METADATA_KEYS.has(normalizedKey)) {
    return false;
  }

  if (ERROR_DETAIL_SENSITIVE_EXACT_KEYS.has(normalizedKey)) {
    return true;
  }

  return ERROR_DETAIL_SENSITIVE_SUFFIXES.some((suffix) => normalizedKey.endsWith(suffix));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type StructuredSanitizerOptions = {
  maxDepth?: number;
  redactStrings?: boolean;
  dropSensitiveKeys?: boolean;
};

function sanitizeStructuredValue(
  value: unknown,
  depth: number,
  options: Required<StructuredSanitizerOptions>
): unknown {
  if (depth > options.maxDepth) {
    return ERROR_DETAIL_TRUNCATED_MARKER;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return options.redactStrings ? redactSensitiveText(value) : value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeStructuredValue(entry, depth + 1, options))
      .filter((entry) => typeof entry !== "undefined");
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const sanitizedEntries = Object.entries(value)
    .filter(([key]) => !options.dropSensitiveKeys || !isSensitiveErrorDetailKey(key))
    .flatMap(([key, entryValue]) => {
      const sanitizedValue = sanitizeStructuredValue(entryValue, depth + 1, options);
      return typeof sanitizedValue === "undefined" ? [] : [[key, sanitizedValue] as const];
    });

  return Object.fromEntries(sanitizedEntries);
}

export function sanitizeStructuredSensitiveData(
  value: unknown,
  options: StructuredSanitizerOptions = {}
): unknown {
  return sanitizeStructuredValue(value, 0, {
    maxDepth: options.maxDepth ?? MAX_ERROR_DETAIL_DEPTH,
    redactStrings: options.redactStrings ?? false,
    dropSensitiveKeys: options.dropSensitiveKeys ?? true
  });
}

export function sanitizeErrorDetails(details: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(details)) {
    return undefined;
  }

  const sanitized = sanitizeStructuredSensitiveData(details, {
    maxDepth: MAX_ERROR_DETAIL_DEPTH,
    redactStrings: false,
    dropSensitiveKeys: true
  });
  if (!isPlainObject(sanitized)) {
    return undefined;
  }

  return sanitized;
}
