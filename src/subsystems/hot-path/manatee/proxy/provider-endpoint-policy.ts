import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isLoopbackHostname, normalizeHostname } from "../../../../platform/net-utils";

export interface ProviderEndpointSecurityOptions {
  allowPrivateEndpoints: boolean;
  allowInsecureHttp: boolean;
}

type LookupAddressResult = {
  address: string;
  family: number;
};

type Ipv6Words = [number, number, number, number, number, number, number, number];
type Ipv6SpecialUseRange = {
  label: string;
  prefix: Ipv6Words;
  prefixLength: number;
};

export interface PinnedProviderEndpointResolution {
  hostname: string;
  address: string;
  family: number;
}

type CachedPinnedProviderEndpointResolution = {
  expiresAtMs: number;
  lastAccessedAtMs: number;
} & (
  | {
      resolution: PinnedProviderEndpointResolution;
      rejectedAddress?: never;
    }
  | {
      resolution?: never;
      rejectedAddress: string;
    }
);

const DEFAULT_PINNED_PROVIDER_ENDPOINT_CACHE_TTL_MS = 30_000;
const DEFAULT_REJECTED_PROVIDER_ENDPOINT_CACHE_TTL_MS = 300_000;
const MAX_PINNED_PROVIDER_ENDPOINT_CACHE_ENTRIES = 512;
const providerEndpointResolutionCache = new Map<string, CachedPinnedProviderEndpointResolution>();
// Endpoint policy blocks special-use ranges too; documentation and benchmark
// networks are not private, but they are never valid production providers.
const IPV6_SPECIAL_USE_RANGES: readonly Ipv6SpecialUseRange[] = [
  {
    label: "unspecified",
    prefix: [0, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 128
  },
  {
    label: "loopback",
    prefix: [0, 0, 0, 0, 0, 0, 0, 1],
    prefixLength: 128
  },
  {
    label: "IPv4-IPv6 translation",
    prefix: [0x64, 0xff9b, 0, 0, 0, 0, 0, 0],
    prefixLength: 96
  },
  {
    label: "local-use IPv4-IPv6 translation",
    prefix: [0x64, 0xff9b, 0x1, 0, 0, 0, 0, 0],
    prefixLength: 48
  },
  {
    label: "discard-only",
    prefix: [0x100, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 64
  },
  {
    label: "Teredo",
    prefix: [0x2001, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 32
  },
  {
    label: "benchmarking",
    prefix: [0x2001, 0x2, 0, 0, 0, 0, 0, 0],
    prefixLength: 48
  },
  {
    label: "documentation",
    prefix: [0x2001, 0xdb8, 0, 0, 0, 0, 0, 0],
    prefixLength: 32
  },
  {
    label: "6to4",
    prefix: [0x2002, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 16
  },
  {
    label: "unique local",
    prefix: [0xfc00, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 7
  },
  {
    label: "link-local",
    prefix: [0xfe80, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 10
  },
  {
    label: "multicast",
    prefix: [0xff00, 0, 0, 0, 0, 0, 0, 0],
    prefixLength: 8
  }
];

export class ResolvedPrivateEndpointError extends Error {
  readonly hostname: string;
  readonly address: string;

  constructor(hostname: string, address: string) {
    super(
      `Provider endpoint hostname '${hostname}' resolved to private/local address '${address}', but 'allow_private_endpoints' is false.`
    );
    this.name = "ResolvedPrivateEndpointError";
    this.hostname = hostname;
    this.address = address;
  }
}

function getPinnedProviderEndpointCacheKey(parsedUrl: URL): string {
  return parsedUrl.hostname.trim().toLowerCase();
}

function prunePinnedProviderEndpointResolutionCache(
  cache: Map<string, CachedPinnedProviderEndpointResolution>,
  nowMs: number
): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAtMs <= nowMs) {
      cache.delete(key);
    }
  }

  while (cache.size > MAX_PINNED_PROVIDER_ENDPOINT_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    cache.delete(oldestKey);
  }
}

function setCachedPinnedProviderEndpointResolution(
  cache: Map<string, CachedPinnedProviderEndpointResolution>,
  cacheKey: string,
  entry: CachedPinnedProviderEndpointResolution,
  nowMs: number
): void {
  cache.delete(cacheKey);
  cache.set(cacheKey, entry);
  prunePinnedProviderEndpointResolutionCache(cache, nowMs);
}

function touchCachedPinnedProviderEndpointResolution(
  cache: Map<string, CachedPinnedProviderEndpointResolution>,
  cacheKey: string,
  entry: CachedPinnedProviderEndpointResolution,
  nowMs: number
): CachedPinnedProviderEndpointResolution {
  const nextEntry = {
    ...entry,
    lastAccessedAtMs: nowMs
  };
  setCachedPinnedProviderEndpointResolution(cache, cacheKey, nextEntry, nowMs);
  return nextEntry;
}

function looksLikeNonCanonicalNumericHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  if (/^\d+$/.test(normalized)) {
    return true;
  }

  if (/^[\d.]+$/.test(normalized)) {
    return true;
  }

  return normalized.includes("0x") && /^[0-9a-fx.]+$/i.test(normalized);
}

function parseIpv4Octets(hostname: string): number[] | null {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return parts;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = parseIpv4Octets(hostname);
  if (parts === null) {
    return false;
  }

  const first = parts[0];
  const second = parts[1];
  if (typeof first === "undefined" || typeof second === "undefined") {
    return false;
  }
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function isLoopbackIpv4(hostname: string): boolean {
  const parts = parseIpv4Octets(hostname);
  if (parts === null) {
    return false;
  }
  const first = parts[0];
  return parts.length === 4 && Number.isInteger(first) && first === 127;
}

function isLinkLocalIpv4(hostname: string): boolean {
  const parts = parseIpv4Octets(hostname);
  if (parts === null) {
    return false;
  }
  return parts.length === 4 && parts[0] === 169 && parts[1] === 254;
}

function isReservedIpv4(hostname: string): boolean {
  const parts = parseIpv4Octets(hostname);
  if (parts === null) {
    return false;
  }

  const first = parts[0];
  const second = parts[1];
  const third = parts[2];
  if (typeof first === "undefined" || typeof second === "undefined" || typeof third === "undefined") {
    return false;
  }

  return (
    first === 0 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function extractMappedIpv4FromIpv6(hostname: string): string | null {
  const normalized = hostname.trim().toLowerCase();
  const dottedTailMatch = normalized.match(/^::ffff:(?:0:)?(.+)$/);

  if (dottedTailMatch) {
    const dottedTail = dottedTailMatch[1];

    if (typeof dottedTail === "string" && isIP(dottedTail) === 4) {
      return dottedTail;
    }
  }

  const hexTailMatch = normalized.match(/^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexTailMatch) {
    return null;
  }

  const highWordText = hexTailMatch[1];
  const lowWordText = hexTailMatch[2];
  if (typeof highWordText !== "string" || typeof lowWordText !== "string") {
    return null;
  }

  const highWord = Number.parseInt(highWordText, 16);
  const lowWord = Number.parseInt(lowWordText, 16);
  if (!Number.isInteger(highWord) || !Number.isInteger(lowWord)) {
    return null;
  }

  return [
    (highWord >>> 8) & 0xff,
    highWord & 0xff,
    (lowWord >>> 8) & 0xff,
    lowWord & 0xff
  ].join(".");
}

function parseIpv6WordSequence(text: string): number[] | null {
  if (text.length === 0) {
    return [];
  }

  const words: number[] = [];
  const parts = text.split(":");

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (typeof part !== "string" || part.length === 0) {
      return null;
    }

    if (part.includes(".")) {
      if (index !== parts.length - 1) {
        return null;
      }

      const octets = parseIpv4Octets(part);
      if (octets === null) {
        return null;
      }

      const first = octets[0];
      const second = octets[1];
      const third = octets[2];
      const fourth = octets[3];
      if (
        typeof first !== "number" ||
        typeof second !== "number" ||
        typeof third !== "number" ||
        typeof fourth !== "number"
      ) {
        return null;
      }

      words.push((first << 8) | second, (third << 8) | fourth);
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/.test(part)) {
      return null;
    }

    words.push(Number.parseInt(part, 16));
  }

  return words;
}

function parseIpv6Words(hostname: string): Ipv6Words | null {
  const normalized = hostname.trim().toLowerCase();
  const compressedParts = normalized.split("::");

  if (compressedParts.length > 2) {
    return null;
  }

  const hasCompression = compressedParts.length === 2;
  const headText = compressedParts[0];
  const tailText = hasCompression ? compressedParts[1] : "";
  if (typeof headText !== "string" || typeof tailText !== "string") {
    return null;
  }

  const headWords = parseIpv6WordSequence(headText);
  const tailWords = hasCompression ? parseIpv6WordSequence(tailText) : [];
  if (headWords === null || tailWords === null) {
    return null;
  }

  const zeroWordCount = 8 - headWords.length - tailWords.length;
  if (hasCompression) {
    if (zeroWordCount < 1) {
      return null;
    }
  } else if (zeroWordCount !== 0) {
    return null;
  }

  const words = [...headWords, ...Array.from({ length: zeroWordCount }, () => 0), ...tailWords];
  if (words.length !== 8) {
    return null;
  }

  return words as Ipv6Words;
}

function ipv6MatchesCidr(words: Ipv6Words, range: Ipv6SpecialUseRange): boolean {
  let remainingBits = range.prefixLength;

  for (let index = 0; index < words.length; index += 1) {
    if (remainingBits <= 0) {
      return true;
    }

    const word = words[index];
    const prefixWord = range.prefix[index];
    if (typeof word !== "number" || typeof prefixWord !== "number") {
      return false;
    }

    const bitsToCompare = Math.min(remainingBits, 16);
    const mask = bitsToCompare === 16 ? 0xffff : (0xffff << (16 - bitsToCompare)) & 0xffff;
    if ((word & mask) !== (prefixWord & mask)) {
      return false;
    }

    remainingBits -= bitsToCompare;
  }

  return remainingBits === 0;
}

function isPrivateOrLocalIpv6(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  const mappedIpv4 = extractMappedIpv4FromIpv6(normalized);

  if (mappedIpv4 !== null) {
    return (
      isLoopbackIpv4(mappedIpv4) ||
      isLinkLocalIpv4(mappedIpv4) ||
      isPrivateIpv4(mappedIpv4) ||
      isReservedIpv4(mappedIpv4)
    );
  }

  const words = parseIpv6Words(normalized);
  return words !== null && IPV6_SPECIAL_USE_RANGES.some((range) => ipv6MatchesCidr(words, range));
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  const ipCandidate = normalized;

  if (isLoopbackHostname(normalized, { allowLocalhostSubdomains: true })) {
    return true;
  }

  const ipVersion = isIP(ipCandidate);
  if (ipVersion === 4) {
    return (
      isLoopbackIpv4(ipCandidate) ||
      isLinkLocalIpv4(ipCandidate) ||
      isPrivateIpv4(ipCandidate) ||
      isReservedIpv4(ipCandidate)
    );
  }

  if (ipVersion === 6) {
    return isPrivateOrLocalIpv6(ipCandidate);
  }

  return false;
}

export function validateProviderEndpointPolicy(
  providerName: string,
  endpoint: string,
  options: ProviderEndpointSecurityOptions
): URL {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(endpoint);
  } catch (error) {
    throw new Error(`Service provider '${providerName}' must contain a valid URL 'endpoint': ${(error as Error).message}`);
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error(`Service provider '${providerName}' must use an 'http' or 'https' endpoint URL.`);
  }

  if (parsedUrl.username.length > 0 || parsedUrl.password.length > 0) {
    throw new Error(
      `Service provider '${providerName}' must not include userinfo in the 'endpoint' URL; use 'api_key' or 'api_key_env' instead.`
    );
  }

  if (parsedUrl.protocol === "http:" && !options.allowInsecureHttp) {
    throw new Error(
      `Service provider '${providerName}' uses insecure HTTP; set 'allow_insecure_http' to true to permit this explicitly.`
    );
  }

  if (isIP(parsedUrl.hostname) === 0 && looksLikeNonCanonicalNumericHostname(parsedUrl.hostname)) {
    throw new Error(
      `Service provider '${providerName}' must use a canonical hostname or IP literal in 'endpoint'; non-canonical numeric host notation is not allowed.`
    );
  }

  if (isPrivateOrLocalHostname(parsedUrl.hostname) && !options.allowPrivateEndpoints) {
    throw new Error(
      `Service provider '${providerName}' targets a private or local endpoint; set 'allow_private_endpoints' to true to permit this explicitly.`
    );
  }

  // Provider endpoint query parameters can be part of the real upstream
  // contract (for example Azure's api-version), so preserve search
  // intentionally. URL fragments are never meaningful for upstream HTTP
  // requests here, so strip them from the normalized result.
  parsedUrl.hash = "";

  return parsedUrl;
}

export async function assertResolvedProviderEndpointPolicy(
  parsedUrl: URL,
  options: Pick<ProviderEndpointSecurityOptions, "allowPrivateEndpoints">,
  deps: {
    lookupAddresses?: (hostname: string) => Promise<LookupAddressResult[]>;
    cache?: Map<string, CachedPinnedProviderEndpointResolution>;
    nowMs?: number;
    cacheTtlMs?: number;
    rejectedCacheTtlMs?: number;
  } = {}
): Promise<PinnedProviderEndpointResolution | null> {
  if (isIP(parsedUrl.hostname) !== 0 || parsedUrl.hostname === "localhost" || parsedUrl.hostname.endsWith(".localhost")) {
    return null;
  }

  const lookupAddresses =
    deps.lookupAddresses ??
    (async (hostname: string): Promise<LookupAddressResult[]> => {
      return await lookup(hostname, { all: true, verbatim: true });
    });
  const cache = deps.cache ?? providerEndpointResolutionCache;
  const nowMs = deps.nowMs ?? Date.now();
  const cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_PINNED_PROVIDER_ENDPOINT_CACHE_TTL_MS;
  const rejectedCacheTtlMs = deps.rejectedCacheTtlMs ?? DEFAULT_REJECTED_PROVIDER_ENDPOINT_CACHE_TTL_MS;
  const cacheKey = getPinnedProviderEndpointCacheKey(parsedUrl);

  prunePinnedProviderEndpointResolutionCache(cache, nowMs);

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAtMs > nowMs) {
    const touched = touchCachedPinnedProviderEndpointResolution(cache, cacheKey, cached, nowMs);
    if ("rejectedAddress" in touched && typeof touched.rejectedAddress === "string") {
      if (!options.allowPrivateEndpoints) {
        throw new ResolvedPrivateEndpointError(parsedUrl.hostname, touched.rejectedAddress);
      }

      cache.delete(cacheKey);
    } else if ("resolution" in touched && typeof touched.resolution !== "undefined") {
      if (isPrivateOrLocalHostname(touched.resolution.address) && !options.allowPrivateEndpoints) {
        throw new ResolvedPrivateEndpointError(parsedUrl.hostname, touched.resolution.address);
      }

      return touched.resolution;
    }
  }

  const resolved = await lookupAddresses(parsedUrl.hostname);
  let pinnedEntry: LookupAddressResult | null = null;

  for (const entry of resolved) {
    if (isPrivateOrLocalHostname(entry.address) && !options.allowPrivateEndpoints) {
      if (rejectedCacheTtlMs > 0) {
        setCachedPinnedProviderEndpointResolution(cache, cacheKey, {
          expiresAtMs: nowMs + rejectedCacheTtlMs,
          lastAccessedAtMs: nowMs,
          rejectedAddress: entry.address
        }, nowMs);
      }
      throw new ResolvedPrivateEndpointError(parsedUrl.hostname, entry.address);
    }

    if (pinnedEntry === null) {
      pinnedEntry = entry;
    }
  }

  if (pinnedEntry === null) {
    throw new Error(`Provider endpoint hostname '${parsedUrl.hostname}' did not resolve to any usable address.`);
  }

  const pinnedResolution = {
    hostname: parsedUrl.hostname,
    address: pinnedEntry.address,
    family: pinnedEntry.family
  };

  if (cacheTtlMs > 0) {
    setCachedPinnedProviderEndpointResolution(cache, cacheKey, {
      expiresAtMs: nowMs + cacheTtlMs,
      lastAccessedAtMs: nowMs,
      resolution: pinnedResolution
    }, nowMs);
  }

  return pinnedResolution;
}
