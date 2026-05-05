import { safeJsonStringifyWithinBounds } from "../../../../platform/json-bounds";
import { logLine } from "../../../../platform/logger";
import { type ApiMode, type AppConfig } from "../../../../platform/types";
import { classifyFetchError, describeTestFailure } from "./proxy-error-classification";
import { forwardUpstreamRequest } from "./proxy-forwarding";
import { applyProviderHeaders } from "./proxy-headers";
import { safeLogField, safeLogReason } from "./proxy-logging";
import { createUpstreamUrl } from "./upstream-url";
import { buildUpstreamModel } from "./proxy-upstream-model";

export type RouteTestResult = {
  route: string;
  service_provider: string;
  api_mode: ApiMode;
  status: "pass" | "fail";
  status_code: number;
  latency_ms: number;
  reason: string | null;
};

export async function runRouteTestsDetailed(
  config: AppConfig,
  options?: {
    routeName?: string;
    log?: boolean;
    onResult?: (result: RouteTestResult) => void;
  }
): Promise<{
  passed: number;
  failed: number;
  results: RouteTestResult[];
}> {
  const routeEntries = Object.entries(config.routes).filter(([bareModel]) =>
    options?.routeName ? bareModel === options.routeName : true
  );
  let passed = 0;
  let failed = 0;
  const results: RouteTestResult[] = [];

  for (const [bareModel, route] of routeEntries) {
    if (options?.log !== false) {
      logLine(
        `Testing  ${bareModel.padEnd(24)} -> ${route.serviceProvider.padEnd(18)} ${route.baseUrl} (${route.api_mode})`
      );
    }

    const upstreamUrl = createUpstreamUrl(route.baseUrl, route.api_mode);
    const startedAt = Date.now();
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      accept: "application/json"
    });
    applyProviderHeaders(headers, route);

    const requestBody = safeJsonStringifyWithinBounds({
      model: buildUpstreamModel(route),
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1
    });

    try {
      const upstreamResponse = await forwardUpstreamRequest(
        upstreamUrl,
        route.allowPrivateEndpoints,
        headers,
        requestBody,
        route.timeoutMs
      );

      if (upstreamResponse.ok) {
        passed += 1;
        const latencyMs = Date.now() - startedAt;
        results.push({
          route: bareModel,
          service_provider: route.serviceProvider,
          api_mode: route.api_mode,
          status: "pass",
          status_code: upstreamResponse.status,
          latency_ms: latencyMs,
          reason: null
        });
        const latestResult = results[results.length - 1];
        if (latestResult) {
          options?.onResult?.(latestResult);
        }
        if (options?.log !== false) {
          logLine(`  PASS   ${bareModel.padEnd(24)} status=${upstreamResponse.status}  latency=${latencyMs}ms`);
        }
        continue;
      }

      failed += 1;
      const reason = describeTestFailure(upstreamResponse.status);
      const latencyMs = Date.now() - startedAt;
      results.push({
        route: bareModel,
        service_provider: route.serviceProvider,
        api_mode: route.api_mode,
        status: "fail",
        status_code: upstreamResponse.status,
        latency_ms: latencyMs,
        reason
      });
      const latestResult = results[results.length - 1];
      if (latestResult) {
        options?.onResult?.(latestResult);
      }
      if (options?.log !== false) {
        logLine(
          `  FAIL   ${safeLogField(bareModel, 24).padEnd(24)} status=${upstreamResponse.status}  reason="${safeLogReason(reason)}"`
        );
      }
    } catch (error) {
      failed += 1;
      const classified = classifyFetchError(error);
      const latencyMs = Date.now() - startedAt;
      results.push({
        route: bareModel,
        service_provider: route.serviceProvider,
        api_mode: route.api_mode,
        status: "fail",
        status_code: classified.statusCode,
        latency_ms: latencyMs,
        reason: classified.message
      });
      const latestResult = results[results.length - 1];
      if (latestResult) {
        options?.onResult?.(latestResult);
      }
      if (options?.log !== false) {
        logLine(
          `  FAIL   ${safeLogField(bareModel, 24).padEnd(24)} status=${classified.statusCode}  reason="${safeLogReason(classified.message)}"`
        );
      }
    }
  }

  if (options?.log !== false) {
    logLine(`Results: ${passed} passed, ${failed} failed`);
  }

  return {
    passed,
    failed,
    results
  };
}

export async function runRouteTests(config: AppConfig): Promise<number> {
  const summary = await runRouteTestsDetailed(config, { log: true });
  if (summary.results.length === 0) {
    logLine("Results: 0 passed, 0 failed");
  }
  return summary.failed === 0 ? 0 : 1;
}
