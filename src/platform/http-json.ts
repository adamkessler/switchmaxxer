import {
  HARD_MAX_JSON_SERIALIZED_BYTES,
  parseJsonWithinBounds
} from "./json-bounds";
import { parseCanonicalNonNegativeInteger } from "./number-parsing";
import { isRecord } from "./type-guards";

export class HttpResponseBodyTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`response body exceeded ${maxBytes} bytes`);
    this.name = "HttpResponseBodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}

export async function readResponseTextWithinBounds(
  response: Response,
  maxBytes = HARD_MAX_JSON_SERIALIZED_BYTES
): Promise<string> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const declaredLength = parseCanonicalNonNegativeInteger(contentLengthHeader);
    if (declaredLength !== null && declaredLength > maxBytes) {
      throw new HttpResponseBodyTooLargeError(maxBytes);
    }
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        throw new HttpResponseBodyTooLargeError(maxBytes);
      }

      chunks.push(chunk);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Best-effort cleanup only.
    }
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function parseJsonResponseWithinBounds(
  response: Response,
  options: {
    maxNodeCount?: number;
    maxDepth?: number;
    maxSerializedBytes?: number;
  } = {}
): Promise<unknown> {
  const rawText = await readResponseTextWithinBounds(
    response,
    options.maxSerializedBytes ?? HARD_MAX_JSON_SERIALIZED_BYTES
  );
  return parseJsonWithinBounds(rawText, options);
}

export async function parseJsonObjectResponseWithinBounds(
  response: Response,
  options: {
    maxNodeCount?: number;
    maxDepth?: number;
    maxSerializedBytes?: number;
  } = {}
): Promise<Record<string, unknown>> {
  const parsed = await parseJsonResponseWithinBounds(response, options);

  if (!isRecord(parsed)) {
    throw new Error("json_payload_not_object");
  }

  return parsed;
}
