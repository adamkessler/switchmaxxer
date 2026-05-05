import { parseCanonicalNonNegativeInteger } from "../../../../platform/number-parsing";
import { BufferedResponseLimitError } from "./proxy-error-classification";

export async function bufferResponseWithinLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (typeof contentLengthHeader === "string") {
    const declaredLength = parseCanonicalNonNegativeInteger(contentLengthHeader);
    if (declaredLength !== null && declaredLength > maxBytes) {
      throw new BufferedResponseLimitError(maxBytes);
    }
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
        throw new BufferedResponseLimitError(maxBytes);
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

  return Buffer.concat(chunks);
}
