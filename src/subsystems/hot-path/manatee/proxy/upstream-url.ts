import type { ApiMode } from "../../../../platform/types";

export function createUpstreamUrl(baseUrl: string, apiMode: ApiMode): string {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const lastSegment = segments[segments.length - 1] ?? null;
  const secondToLastSegment = segments[segments.length - 2] ?? null;

  if (
    (secondToLastSegment === "chat" && lastSegment === "completions") ||
    lastSegment === "messages"
  ) {
    url.pathname = pathname;
    return url.toString();
  }

  if (apiMode === "anthropic-messages") {
    if (pathname.endsWith("/anthropic")) {
      url.pathname = `${pathname}/v1/messages`;
    } else if (pathname.endsWith("/v1")) {
      url.pathname = `${pathname}/messages`;
    } else {
      url.pathname = `${pathname}/messages`;
    }
  } else {
    url.pathname = `${pathname}/chat/completions`;
  }

  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  return url.toString();
}
