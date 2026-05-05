import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { resolveNonNegativeIntegerEnv, resolvePositiveIntegerEnv } from "../../platform/env";
import type { ProxyRequest, ProxyResponse } from "../proxy/proxy";
import { proxyChatCompletion } from "../proxy/proxy";
import { setRuntimeLogLevelOverride, withLogWriters } from "../../platform/logger";
import { configureGatewayObservability } from "../observability/gateway";
import { resetGatewayObservabilityRuntimeForIsolatedRun } from "../observability/gateway-observability-runtime-control";
import { SecretString } from "../../platform/secret-string";
import type { AppConfig } from "../../platform/types";

class MockServerResponse extends Writable {
  statusCode = 200;
  headersSent = false;
  private readonly headers = new Map<string, string | number | readonly string[]>();
  body = Buffer.alloc(0);

  constructor() {
    super();
  }

  setHeader(name: string, value: string | number | readonly string[]): this {
    let normalizedValue: string | number | readonly string[];

    if (Array.isArray(value)) {
      normalizedValue = [...value];
    } else {
      normalizedValue = value;
    }

    this.headers.set(name.toLowerCase(), normalizedValue);

    return this;
  }

  getHeader(name: string): string | number | readonly string[] | undefined {
    const value = this.headers.get(name.toLowerCase());
    return Array.isArray(value) ? [...value] : value;
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

function makeMockIncomingRequest(params: {
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

function makeMockServerResponse(): MockServerResponse & ProxyResponse {
  return new MockServerResponse();
}

type ScenarioResult = {
  name: string;
  iterations: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
};

let perfScenarioRunInProgress = false;

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const clampedPercentile = Math.min(100, Math.max(0, p));

  if (sorted.length === 1 || clampedPercentile === 0) {
    return sorted[0] ?? 0;
  }

  if (clampedPercentile === 100) {
    return sorted[sorted.length - 1] ?? 0;
  }

  const rank = (clampedPercentile / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;

  if (lowerIndex === upperIndex) {
    return lower;
  }

  const fraction = rank - lowerIndex;
  return lower + (upper - lower) * fraction;
}

async function discardProcessOutput<T>(fn: () => Promise<T>): Promise<T> {
  return await withLogWriters(
    {
      stdout: () => {},
      stderr: () => {}
    },
    fn
  );
}

function baseConfig(sourcePath: string): AppConfig {
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
    sourcePath,
    routes: {
      "route-perf": {
        serviceProvider: "provider-perf",
        api_mode: "openai-completions",
        anthropicVersion: null,
        modelCreator: "openai",
        model: "provider-model-perf",
        baseUrl: "https://perf-test.example/v1",
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

export async function runScenario(name: string, options: {
  iterations: number;
  warmup: number;
  observabilityEnabled: boolean;
  debugLogging: boolean;
}): Promise<ScenarioResult> {
  if (perfScenarioRunInProgress) {
    throw new Error(
      "perf-gateway scenarios are sequential-only because logger and observability overrides remain module-global"
    );
  }

  perfScenarioRunInProgress = true;
  const tempDir = mkdtempSync(path.join(tmpdir(), "switchmaxxer-perf-gateway-"));

  // This perf harness remains sequential-only. We now inject fetch per scenario,
  // but gateway observability and logger runtime overrides are still module-global.
  // Do not run scenarios concurrently without first scoping those overrides per scenario.
  const fetchImpl = (async (): Promise<Response> => {
    const body = `${JSON.stringify({
      id: "chatcmpl-perf",
      object: "chat.completion",
      created: 1,
      model: "provider-model-perf",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "perf"
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7
      }
    })}\n`;

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    });
  }) as typeof fetch;

  setRuntimeLogLevelOverride(options.debugLogging ? "debug" : "info");
  await resetGatewayObservabilityRuntimeForIsolatedRun();
  configureGatewayObservability({
    retentionOlderThan: null,
    disabled: !options.observabilityEnabled,
    dbPath: options.observabilityEnabled ? path.join(tempDir, "observability.sqlite") : null
  });

  const config = baseConfig(path.join(tempDir, "config.json"));
  const request = makeMockIncomingRequest({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      "content-type": "application/json",
      "x-switchmaxxer-caller": "perf-harness"
    },
    remoteAddress: "127.0.0.1"
  });
  const parsedBody = {
    model: "route-perf",
    messages: [
      {
        role: "user",
        content: "ping"
      }
    ],
    stream: false
  };

  try {
    await discardProcessOutput(async () => {
      for (let index = 0; index < options.warmup; index += 1) {
        const response = makeMockServerResponse();
        await proxyChatCompletion(request, response, config, parsedBody, JSON.stringify(parsedBody), {
          fetchImpl
        });
      }
    });

    const samples: number[] = [];

    await discardProcessOutput(async () => {
      for (let index = 0; index < options.iterations; index += 1) {
        const response = makeMockServerResponse();
        const startedAt = process.hrtime.bigint();
        await proxyChatCompletion(request, response, config, parsedBody, JSON.stringify(parsedBody), {
          fetchImpl
        });
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        samples.push(elapsedMs);
      }
    });

    const sorted = [...samples].sort((left, right) => left - right);
    const total = samples.reduce((sum, value) => sum + value, 0);

    return {
      name,
      iterations: options.iterations,
      avgMs: total / samples.length,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      minMs: sorted[0] ?? 0,
      maxMs: sorted[sorted.length - 1] ?? 0
    };
  } finally {
    setRuntimeLogLevelOverride(null);
    await resetGatewayObservabilityRuntimeForIsolatedRun();
    rmSync(tempDir, { recursive: true, force: true });
    perfScenarioRunInProgress = false;
  }
}

function formatRow(result: ScenarioResult): string {
  const cells = [
    result.name.padEnd(24),
    String(result.iterations).padStart(6),
    result.avgMs.toFixed(3).padStart(10),
    result.p50Ms.toFixed(3).padStart(10),
    result.p95Ms.toFixed(3).padStart(10),
    result.p99Ms.toFixed(3).padStart(10),
    result.minMs.toFixed(3).padStart(10),
    result.maxMs.toFixed(3).padStart(10)
  ];

  return cells.join("  ");
}

async function main(): Promise<void> {
  const iterations = resolvePositiveIntegerEnv("SWITCHMAXXER_PERF_ITERATIONS", 250);
  const warmup = resolveNonNegativeIntegerEnv("SWITCHMAXXER_PERF_WARMUP", 25);

  const scenarios = [
    {
      name: "obs-off info",
      observabilityEnabled: false,
      debugLogging: false
    },
    {
      name: "obs-on info",
      observabilityEnabled: true,
      debugLogging: false
    },
    {
      name: "obs-off debug",
      observabilityEnabled: false,
      debugLogging: true
    },
    {
      name: "obs-on debug",
      observabilityEnabled: true,
      debugLogging: true
    }
  ] as const;

  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    results.push(await runScenario(scenario.name, {
      iterations,
      warmup,
      observabilityEnabled: scenario.observabilityEnabled,
      debugLogging: scenario.debugLogging
    }));
  }

  process.stdout.write("Switchmaxxer gateway perf harness\n");
  process.stdout.write(`Iterations: ${iterations}  Warmup: ${warmup}\n\n`);
  process.stdout.write("Scenario                   iters      avg_ms      p50_ms      p95_ms      p99_ms      min_ms      max_ms\n");
  process.stdout.write("----------------------------------------------------------------------------------------------------------------\n");

  for (const result of results) {
    process.stdout.write(`${formatRow(result)}\n`);
  }
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
