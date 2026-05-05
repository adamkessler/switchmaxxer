import {
  HARD_MAX_JSON_DEPTH,
  HARD_MAX_JSON_NODE_COUNT,
  HARD_MAX_JSON_SERIALIZED_BYTES,
  parseJsonWithinBounds
} from "../../platform/json-bounds";
import { isObjectLike } from "../../platform/type-guards";

export class UnsupportedTextContentError extends Error {
  constructor(message = "Encountered unsupported content shape during text normalization.") {
    super(message);
    this.name = "UnsupportedTextContentError";
  }
}

export function parseJsonObjectWithinBounds(rawJson: string, context: string): Record<string, unknown> {
  const parsed = parseJsonWithinBounds(rawJson, {
    maxNodeCount: HARD_MAX_JSON_NODE_COUNT,
    maxDepth: HARD_MAX_JSON_DEPTH,
    maxSerializedBytes: HARD_MAX_JSON_SERIALIZED_BYTES
  });

  if (!isObjectLike(parsed)) {
    throw new Error(`${context} must be a JSON object.`);
  }

  return parsed;
}
