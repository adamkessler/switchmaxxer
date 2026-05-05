import type { IncomingHttpHeaders } from "node:http";

import { resolveRouteApiKey } from "../../../config/provider-auth";
import { REDACTED_SECRET } from "../../../../platform/secret-string";
import type { RouteConfig } from "../../../../platform/types";
import type { ProxyResponseLike } from "./proxy-forwarding";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

const BLOCKED_UPSTREAM_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "forwarded",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto"
]);

const MANAGED_HEADERS = new Set([
  "accept-encoding",
  "authorization",
  "x-api-key",
  "x-switchmaxxer-inspect",
  "x-switchmaxxer-inspect-id",
  "x-switchmaxxer-inspect-token",
  "anthropic-version",
  "host",
  "content-length"
]);

const LOCAL_BROWSER_CONTEXT_HEADERS = new Set([
  "cookie",
  "cookie2",
  "origin",
  "referer",
  "referrer",
  "user-agent"
]);

const SENSITIVE_LOG_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key"
]);

const UPSTREAM_USER_AGENT = "switchmaxxer-gateway";
const MAX_FORWARDED_HEADER_VALUE_BYTES = 8 * 1024;

function assertSafeForwardedHeaderValue(value: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_FORWARDED_HEADER_VALUE_BYTES) {
    throw new Error("invalid_header_value");
  }

  if (!/^[\x09\x20-\x7e]*$/.test(value)) {
    throw new Error("invalid_header_value");
  }
}

function isSafeForwardedHeaderName(name: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
}

export function sanitizeIncomingHeaders(headers: IncomingHttpHeaders): Headers {
  const sanitized = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    if (
      HOP_BY_HOP_HEADERS.has(lowerKey) ||
      MANAGED_HEADERS.has(lowerKey) ||
      LOCAL_BROWSER_CONTEXT_HEADERS.has(lowerKey)
    ) {
      continue;
    }

    if (typeof value === "undefined") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        assertSafeForwardedHeaderValue(item);
        sanitized.append(lowerKey, item);
      }
      continue;
    }

    assertSafeForwardedHeaderValue(value);
    sanitized.set(lowerKey, value);
  }

  sanitized.set("user-agent", UPSTREAM_USER_AGENT);
  return sanitized;
}

export function applyProviderHeaders(headers: Headers, route: RouteConfig): void {
  const apiKey = resolveRouteApiKey(route);

  if (route.api_mode === "anthropic-messages") {
    headers.set("anthropic-version", route.anthropicVersion ?? "2023-06-01");
    if (apiKey !== null) {
      headers.set("x-api-key", apiKey);
    }
    return;
  }

  if (apiKey !== null) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }
}

export function sanitizeHeadersForLogging(headers: Headers): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    const lowerKey = key.toLowerCase();
    sanitized[lowerKey] = SENSITIVE_LOG_HEADERS.has(lowerKey) ? REDACTED_SECRET : value;
  }

  return sanitized;
}

export function copyResponseHeaders(source: Headers, target: ProxyResponseLike, omittedHeaders: string[] = []): void {
  const omitted = new Set(omittedHeaders.map((header) => header.toLowerCase()));

  for (const [key, value] of source.entries()) {
    const lowerKey = key.toLowerCase();

    if (
      HOP_BY_HOP_HEADERS.has(lowerKey) ||
      BLOCKED_UPSTREAM_RESPONSE_HEADERS.has(lowerKey) ||
      omitted.has(lowerKey) ||
      !isSafeForwardedHeaderName(key)
    ) {
      continue;
    }

    try {
      assertSafeForwardedHeaderValue(value);
    } catch {
      continue;
    }

    target.setHeader(key, value);
  }
}

export function copyBufferedResponseHeaders(source: Headers, target: ProxyResponseLike): void {
  copyResponseHeaders(source, target, ["content-encoding"]);
}
