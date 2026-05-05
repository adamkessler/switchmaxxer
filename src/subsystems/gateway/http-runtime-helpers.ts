import type { IncomingMessage } from "node:http";

import { HARD_MAX_JSON_DEPTH, HARD_MAX_JSON_NODE_COUNT, safeJsonStringifyWithinBounds } from "../../platform/json-bounds";
import { parseCanonicalNonNegativeInteger } from "../../platform/number-parsing";
import type { AppConfig } from "../../platform/types";

export function createGatewayHttpRuntimeHelpers(deps: {
  getCliEnv: () => NodeJS.ProcessEnv;
  isNonEmptyCliString: (value: unknown) => value is string;
  isNonEmptyConfigString: (value: unknown) => value is string;
  isValidSystemdUnitName: (value: string) => boolean;
  defaultSystemdUnit: string;
  maxRequestJsonDepth: number;
}) {
  async function readRequestBodyWithLimit(
    request: IncomingMessage,
    maxPayloadSize: number,
    idleTimeoutMs: number,
    totalTimeoutMs: number
  ): Promise<string> {
    const contentLengthHeader = request.headers["content-length"];

    if (typeof contentLengthHeader === "string") {
      const declaredLength = parseCanonicalNonNegativeInteger(contentLengthHeader);

      if (declaredLength !== null && declaredLength > maxPayloadSize) {
        throw new Error("request_body_too_large");
      }
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const iterator = request[Symbol.asyncIterator]();
    const startedAtMs = Date.now();

    while (true) {
      const elapsedMs = Date.now() - startedAtMs;
      const remainingTotalTimeoutMs = totalTimeoutMs - elapsedMs;

      if (remainingTotalTimeoutMs <= 0) {
        throw new Error("request_body_total_timeout");
      }

      const nextDeadlineMs = Math.min(idleTimeoutMs, remainingTotalTimeoutMs);
      let idleTimer: NodeJS.Timeout | null = null;
      let nextChunk: IteratorResult<Buffer | string>;

      try {
        nextChunk = await Promise.race([
          iterator.next() as Promise<IteratorResult<Buffer | string>>,
          new Promise<never>((_, reject) => {
            idleTimer = setTimeout(() => {
              reject(new Error(nextDeadlineMs === idleTimeoutMs ? "request_body_idle_timeout" : "request_body_total_timeout"));
            }, nextDeadlineMs);
          })
        ]);
      } finally {
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
      }

      if (nextChunk.done) {
        break;
      }

      const chunk = nextChunk.value;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;

      if (totalBytes > maxPayloadSize) {
        throw new Error("request_body_too_large");
      }

      chunks.push(buffer);
    }

    return Buffer.concat(chunks).toString("utf8");
  }

  function validateParsedRequestBodyShape(body: Record<string, unknown>, maxPayloadSize: number): void {
    try {
      safeJsonStringifyWithinBounds(body, {
        maxSerializedBytes: maxPayloadSize,
        maxNodeCount: Math.min(HARD_MAX_JSON_NODE_COUNT, Math.max(1024, Math.floor(maxPayloadSize / 16))),
        maxDepth: Math.min(HARD_MAX_JSON_DEPTH, deps.maxRequestJsonDepth)
      });
    } catch {
      throw new Error("request_body_structure_too_large");
    }
  }

  function resolveConfiguredSystemdUnit(config: Pick<AppConfig, "systemdUnit">): string {
    const override = deps.getCliEnv()["SWITCHMAXXER_UNIT"];
    if (deps.isNonEmptyCliString(override)) {
      if (!deps.isValidSystemdUnitName(override)) {
        throw new Error("Environment variable 'SWITCHMAXXER_UNIT' must contain a valid systemd unit name.");
      }

      return override;
    }

    return config.systemdUnit;
  }

  function resolveSystemdUnitFromDocument(document: Record<string, unknown>): string {
    const override = deps.getCliEnv()["SWITCHMAXXER_UNIT"];

    if (deps.isNonEmptyConfigString(override)) {
      if (!deps.isValidSystemdUnitName(override)) {
        throw new Error("Environment variable 'SWITCHMAXXER_UNIT' must contain a valid systemd unit name.");
      }

      return override;
    }

    const candidate = document["systemd_unit"];
    if (!deps.isNonEmptyConfigString(candidate)) {
      return deps.defaultSystemdUnit;
    }

    if (!deps.isValidSystemdUnitName(candidate)) {
      throw new Error("Config field 'systemd_unit' must contain a valid systemd unit name.");
    }

    return candidate;
  }

  return {
    readRequestBodyWithLimit,
    validateParsedRequestBodyShape,
    resolveConfiguredSystemdUnit,
    resolveSystemdUnitFromDocument
  };
}
