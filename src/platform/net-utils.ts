import { isIP } from "node:net";

export function normalizeHostname(rawHostname: string): string {
  const normalized = rawHostname.trim().toLowerCase();

  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

export function isLoopbackHostname(
  rawHostname: string,
  options?: { allowLocalhostSubdomains?: boolean }
): boolean {
  const hostname = normalizeHostname(rawHostname);
  const allowLocalhostSubdomains = options?.allowLocalhostSubdomains === true;

  if (
    hostname === "localhost"
    || (allowLocalhostSubdomains && hostname.endsWith(".localhost"))
    || hostname === "::1"
    || hostname === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  if (hostname.startsWith("::ffff:")) {
    return hostname.slice("::ffff:".length).startsWith("127.");
  }

  if (isIP(hostname) === 4) {
    return hostname.startsWith("127.");
  }

  return false;
}

export function isWildcardBindHostname(rawHostname: string): boolean {
  const hostname = normalizeHostname(rawHostname);

  if (
    hostname === "0.0.0.0"
    || hostname === "::"
    || hostname === "0:0:0:0:0:0:0:0"
  ) {
    return true;
  }

  if (hostname.startsWith("::ffff:")) {
    return hostname.slice("::ffff:".length) === "0.0.0.0";
  }

  return false;
}

export function normalizeHealthProbeHost(bindHost: string): string {
  if (isWildcardBindHostname(bindHost)) {
    return "127.0.0.1";
  }

  return bindHost;
}

export function formatHostForUrl(rawHostname: string): string {
  const hostname = normalizeHostname(rawHostname);

  return isIP(hostname) === 6 ? `[${hostname}]` : hostname;
}

export function buildLocalHttpUrl(hostname: string, port: number, pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

  if (normalizedPath.startsWith("//")) {
    throw new Error("Local HTTP URL paths must be relative to the local origin.");
  }

  return `http://${formatHostForUrl(hostname)}:${port}${normalizedPath}`;
}
