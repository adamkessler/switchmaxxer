import { EventEmitter } from "node:events";
import path from "node:path";
import { Writable } from "node:stream";

import { SecretString } from "../../../../platform/secret-string";
import type { AppConfig, RouteConfig } from "../../../../platform/types";
import type { ProxyRequest, ProxyResponse } from "./proxy";

// Test-only proxy support surface. Production consumers should import from ./proxy.
export { bufferResponseWithinLimit as bufferResponseWithinLimitForTests } from "./proxy-response-buffer";

export class TestProxyResponse extends Writable {
  statusCode = 200;
  headersSent = false;
  private closeEmitted = false;
  private readonly headers = new Map<string, string | number | string[]>();
  body = Buffer.alloc(0);

  constructor() {
    super();
    this.once("finish", () => {
      if (!this.closeEmitted) {
        this.closeEmitted = true;
        this.emit("close");
      }
    });
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
    return this.headers.get(name.toLowerCase());
  }

  removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase());
  }

  _write(chunk: string | Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
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
    this.headersSent = true;

    if (typeof chunkOrCb === "function") {
      return super.end(chunkOrCb);
    }

    if (typeof encodingOrCb === "function") {
      if (typeof chunkOrCb === "undefined") {
        return super.end(encodingOrCb);
      }
      return super.end(chunkOrCb, encodingOrCb);
    }

    if (typeof chunkOrCb === "undefined") {
      return typeof cb === "function" ? super.end(cb) : super.end();
    }

    if (typeof encodingOrCb === "undefined") {
      return typeof cb === "function" ? super.end(chunkOrCb, cb) : super.end(chunkOrCb);
    }

    return typeof cb === "function" ? super.end(chunkOrCb, encodingOrCb, cb) : super.end(chunkOrCb, encodingOrCb);
  }
}

export function makeProxyRequest(): ProxyRequest {
  return Object.assign(new EventEmitter(), {
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      "content-type": "application/json"
    },
    socket: {
      remoteAddress: "127.0.0.1"
    }
  });
}

export function makeProxyConfig(
  apiMode: "openai-completions" | "anthropic-messages",
  options: { serviceProvider?: string; upstreamModelIdFormat?: RouteConfig["upstreamModelIdFormat"] } = {}
): AppConfig {
  return {
    port: 0,
    bindHost: "127.0.0.1",
    maxConnections: 200,
    timeoutMs: 5_000,
    streamIdleTimeoutMs: 5_000,
    streamMaxLifetimeMs: 600_000,
    streamMinBytesPerSecond: 16,
    streamRateWindowMs: 30_000,
    streamMaxEventBytes: 1_048_576,
    streamMaxTotalBytes: 67_108_864,
    maxBufferedUpstreamResponseBytes: 16_777_216,
    maxPayloadSize: 1_000_000,
    rateLimit: {
      requests: 50,
      window: "1s"
    },
    systemdUnit: "switchmaxxer.service",
    observability: {
      retentionOlderThan: null
    },
    benchmark: {
      defaultMaxTokens: 32,
      defaultAnthropicVersion: "2023-06-01"
    },
    sourceFile: "config.json",
    sourcePath: path.resolve("config.json"),
    routes: {
      route_test: {
        serviceProvider: options.serviceProvider ?? "provider-test",
        api_mode: apiMode,
        anthropicVersion: apiMode === "anthropic-messages" ? "2023-06-01" : null,
        upstreamModelIdFormat: options.upstreamModelIdFormat,
        modelCreator: apiMode === "anthropic-messages" ? "anthropic" : "openai",
        model: "provider-model-test",
        baseUrl: apiMode === "anthropic-messages" ? "https://8.8.8.8" : "https://8.8.8.8/v1",
        allowPrivateEndpoints: false,
        apiKeyEnv: null,
        inlineApiKey: new SecretString("test-key"),
        routeTimeoutMs: null,
        timeoutMs: 5_000,
        cost: null,
        modelCost: null
      }
    }
  };
}

export type { ProxyResponse, ProxyRequest };
