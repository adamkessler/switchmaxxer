import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { withLogWriters } from "../../platform/logger";
import type { ProxyRequest, ProxyResponse } from "../proxy/proxy";
import { ObservabilityService } from "./service";
import type { ObservationEvent, ObservationKind, ObservationOutcome, ObservationRecord } from "./types";

export function makeObservation(
  observedAt: string,
  event: ObservationEvent,
  options: {
    kind?: ObservationKind;
    outcome?: ObservationOutcome;
    statusCode?: number;
    attributes?: Record<string, unknown>;
  } = {}
): ObservationRecord {
  return {
    id: `${event}-${observedAt}`,
    observed_at: observedAt,
    request_id: "req-observability-test",
    surface: "gateway",
    kind: options.kind ?? (event.startsWith("debug_") ? "debug" : "measurement"),
    event,
    stage:
      event === "request_received"
        ? "ingress"
        : event === "route_resolved"
          ? "route_resolution"
          : event === "upstream_request_started"
            ? "upstream_request"
            : event === "upstream_response_started" || event === "upstream_response_completed"
              ? "upstream_response"
              : "client_response",
    outcome: options.outcome,
    route_id: "route-alpha",
    route_name: "route-alpha",
    provider_id: "provider-main",
    provider_model_id: "provider-model-1",
    model_id: "model-alpha",
    client_api_mode: "openai",
    upstream_api_mode: "openai-completions",
    status_code: options.statusCode,
    attributes_json: options.attributes ? JSON.stringify(options.attributes) : null
  };
}

export function makeObservationForRequest(
  requestId: string,
  observedAt: string,
  event: ObservationEvent,
  options: {
    kind?: ObservationKind;
    outcome?: ObservationOutcome;
    statusCode?: number;
    attributes?: Record<string, unknown>;
  } = {}
): ObservationRecord {
  return {
    ...makeObservation(observedAt, event, options),
    id: `${requestId}-${event}-${observedAt}`,
    request_id: requestId
  };
}

export function seedSuccessfulRequest(service: ObservabilityService, requestId: string): void {
  const observations: ObservationRecord[] = [
    makeObservationForRequest(requestId, "2026-04-18T14:00:00.000Z", "request_received"),
    makeObservationForRequest(requestId, "2026-04-18T14:00:00.010Z", "route_resolved"),
    makeObservationForRequest(requestId, "2026-04-18T14:00:00.020Z", "upstream_request_started"),
    makeObservationForRequest(requestId, "2026-04-18T14:00:00.040Z", "upstream_response_started", {
      statusCode: 200
    }),
    makeObservationForRequest(requestId, "2026-04-18T14:00:00.050Z", "upstream_response_completed", {
      statusCode: 200
    }),
    makeObservationForRequest(requestId, "2026-04-18T14:00:00.060Z", "client_response_started", {
      statusCode: 200
    }),
    makeObservationForRequest(requestId, "2026-04-18T14:00:00.090Z", "client_response_completed", {
      outcome: "succeeded",
      statusCode: 200
    })
  ];

  for (const observation of observations) {
    service.recordObservation(observation);
  }
}

export async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  let output = "";
  const result = await withLogWriters(
    {
      stdout: (message) => {
        output += message;
      }
    },
    fn
  );

  return { result, output };
}

export async function captureStderr<T>(fn: () => Promise<T> | T): Promise<{ result: T; output: string }> {
  let output = "";
  const result = await withLogWriters(
    {
      stderr: (message) => {
        output += message;
      }
    },
    fn
  );

  return { result, output };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class MockServerResponse extends Writable {
  statusCode = 200;
  headersSent = false;
  private readonly headers = new Map<string, string | number | string[]>();
  body = Buffer.alloc(0);

  constructor() {
    super();
  }

  setHeader(name: string, value: string | number | readonly string[]): this {
    let normalizedValue: string | number | string[];

    if (Array.isArray(value)) {
      normalizedValue = [...value];
    } else if (typeof value === "number") {
      normalizedValue = value;
    } else if (typeof value === "string") {
      normalizedValue = value;
    } else {
      normalizedValue = [...value];
    }

    this.headers.set(name.toLowerCase(), normalizedValue);
    return this;
  }

  getHeader(name: string): string | number | string[] | undefined {
    const value = this.headers.get(name.toLowerCase());
    if (Array.isArray(value)) {
      return [...value];
    }

    return value;
  }

  removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase());
  }

  _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.body = Buffer.concat([this.body, buffer]);
    this.headersSent = true;
    callback();
  }

  override end(cb?: () => void): this;
  override end(chunk: string | Buffer, cb?: () => void): this;
  override end(chunk: string | Buffer, encoding: BufferEncoding, cb?: () => void): this;
  override end(
    chunkOrCb?: string | Buffer | (() => void),
    encodingOrCb?: BufferEncoding | (() => void),
    cb?: () => void
  ): this {
    const callback =
      typeof chunkOrCb === "function" ? chunkOrCb : typeof encodingOrCb === "function" ? encodingOrCb : cb;

    if (typeof chunkOrCb !== "undefined" && typeof chunkOrCb !== "function") {
      this.write(chunkOrCb);
    }

    this.headersSent = true;
    callback?.();
    this.emit("finish");
    this.emit("close");
    return this;
  }
}

export function makeMockIncomingRequest(params: {
  method: string;
  url: string;
  headers: Record<string, string>;
  remoteAddress: string;
}): ProxyRequest {
  return Object.assign(new EventEmitter(), {
    method: params.method,
    url: params.url,
    headers: params.headers,
    socket: {
      remoteAddress: params.remoteAddress
    }
  });
}

export function makeMockServerResponse(): MockServerResponse & ProxyResponse {
  return new MockServerResponse();
}
