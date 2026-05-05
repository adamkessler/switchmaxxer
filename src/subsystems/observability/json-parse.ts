import { parseJsonWithinBounds } from "../../platform/json-bounds";
import { isRecord } from "../../platform/type-guards";

export interface StoredJsonParseWarning {
  code: "invalid_stored_json" | "invalid_stored_json_shape";
  field: string;
  message: string;
}

export function parseJsonTextWithWarning(value: string | null | undefined, field: string): {
  value: unknown;
  warnings: StoredJsonParseWarning[];
} {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      value: null,
      warnings: []
    };
  }

  try {
    return {
      value: parseJsonWithinBounds(value),
      warnings: []
    };
  } catch {
    return {
      value: null,
      warnings: [
        {
          code: "invalid_stored_json",
          field,
          message: `Stored field '${field}' contained invalid JSON and was ignored.`
        }
      ]
    };
  }
}

export function parseJsonObjectWithWarning(value: string | null | undefined, field: string): {
  value: Record<string, unknown>;
  warnings: StoredJsonParseWarning[];
} {
  const parsed = parseJsonTextWithWarning(value, field);

  if (parsed.warnings.length > 0) {
    return {
      value: {},
      warnings: parsed.warnings
    };
  }

  if (!isRecord(parsed.value)) {
    if (parsed.value === null) {
      return {
        value: {},
        warnings: []
      };
    }

    return {
      value: {},
      warnings: [
        {
          code: "invalid_stored_json_shape",
          field,
          message: `Stored field '${field}' must be a JSON object and was ignored.`
        }
      ]
    };
  }

  return {
    value: parsed.value,
    warnings: []
  };
}
