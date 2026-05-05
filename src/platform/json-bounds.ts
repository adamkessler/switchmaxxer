const DEFAULT_MAX_JSON_NODE_COUNT = 16_000;
const DEFAULT_MAX_JSON_DEPTH = 256;
const DEFAULT_MAX_JSON_SERIALIZED_BYTES = 8 * 1024 * 1024;

export const HARD_MAX_JSON_NODE_COUNT = DEFAULT_MAX_JSON_NODE_COUNT;
export const HARD_MAX_JSON_DEPTH = DEFAULT_MAX_JSON_DEPTH;
export const HARD_MAX_JSON_SERIALIZED_BYTES = DEFAULT_MAX_JSON_SERIALIZED_BYTES;

function assertRawJsonNestingWithinBounds(rawText: string, maxDepth: number): void {
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const char = rawText[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
      if (depth > maxDepth) {
        throw new Error("json_structure_too_large");
      }
      continue;
    }

    if (char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
    }
  }
}

export function assertJsonValueWithinBounds(
  value: unknown,
  options: {
    maxNodeCount?: number;
    maxDepth?: number;
  } = {}
): void {
  const maxNodeCount = options.maxNodeCount ?? HARD_MAX_JSON_NODE_COUNT;
  const maxDepth = options.maxDepth ?? HARD_MAX_JSON_DEPTH;
  let nodeCount = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];

  while (stack.length > 0) {
    const current = stack.pop() as { value: unknown; depth: number };
    nodeCount += 1;

    if (nodeCount > maxNodeCount || current.depth > maxDepth) {
      throw new Error("json_structure_too_large");
    }

    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        stack.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }

    if (typeof current.value === "object" && current.value !== null) {
      for (const item of Object.values(current.value)) {
        stack.push({ value: item, depth: current.depth + 1 });
      }
    }
  }
}

export function safeJsonStringifyWithinBounds(
  value: unknown,
  options: {
    maxNodeCount?: number;
    maxDepth?: number;
    maxSerializedBytes?: number;
  } = {}
): string {
  assertJsonValueWithinBounds(value, options);
  const serialized = JSON.stringify(value);
  const maxSerializedBytes = options.maxSerializedBytes ?? HARD_MAX_JSON_SERIALIZED_BYTES;

  if (Buffer.byteLength(serialized, "utf8") > maxSerializedBytes) {
    throw new Error("json_serialized_too_large");
  }

  return serialized;
}

export function parseJsonWithinBounds(
  rawText: string,
  options: {
    maxNodeCount?: number;
    maxDepth?: number;
    maxSerializedBytes?: number;
  } = {}
): unknown {
  const maxSerializedBytes = options.maxSerializedBytes ?? HARD_MAX_JSON_SERIALIZED_BYTES;
  const maxDepth = options.maxDepth ?? HARD_MAX_JSON_DEPTH;

  if (Buffer.byteLength(rawText, "utf8") > maxSerializedBytes) {
    throw new Error("json_serialized_too_large");
  }

  assertRawJsonNestingWithinBounds(rawText, maxDepth);

  const parsed = JSON.parse(rawText) as unknown;
  assertJsonValueWithinBounds(parsed, options);
  return parsed;
}
