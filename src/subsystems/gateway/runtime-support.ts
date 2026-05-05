import {
  parseCanonicalNonNegativeInteger,
  parseCanonicalPositiveInteger
} from "../../platform/number-parsing";
import { normalizeLogLevel, type LogLevel } from "../../platform/types";

export type LogsFormat = "text" | "json";
export type ReadLongFlagValue = (
  argv: string[],
  index: number,
  flagName: string,
  missingValueMessage?: string
) => { consumed: number; value?: string; errorMessage?: string } | null;

const JOURNALCTL_SINCE_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const JOURNALCTL_SINCE_RELATIVE_PATTERN =
  /^\d+ +(?:second|seconds|minute|minutes|hour|hours|day|days|week|weeks) +ago$/i;

function normalizeJournalctlSinceValue(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.startsWith("-") || /[\r\n]/.test(trimmed)) {
    return null;
  }

  if (JOURNALCTL_SINCE_ISO_PATTERN.test(trimmed) || JOURNALCTL_SINCE_RELATIVE_PATTERN.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function parseGatewayRunArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): {
  configPath?: string;
  host?: string;
  port?: number;
  logLevel?: LogLevel;
  errorMessage?: string;
} {
    let configPath: string | undefined;
    let host: string | undefined;
    let port: number | undefined;
    let logLevel: LogLevel | undefined;

    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];

      {
        const parsedFlag = readLongFlagValue(argv, index, "--config", "Flag '--config' requires a path value");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { configPath, errorMessage: parsedFlag.errorMessage };
          }

          configPath = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = readLongFlagValue(argv, index, "--host", "Flag '--host' requires a host value");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { configPath, host, port, errorMessage: parsedFlag.errorMessage };
          }

          if ((parsedFlag.value as string).trim().length === 0) {
            return { configPath, host, port, errorMessage: "Flag '--host' must be a non-empty string" };
          }

          host = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = readLongFlagValue(argv, index, "--port", "Flag '--port' requires a numeric value");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { configPath, host, port, errorMessage: parsedFlag.errorMessage };
          }

          const parsed = parseCanonicalPositiveInteger(parsedFlag.value);

          if (parsed === null) {
            return { configPath, host, port, errorMessage: "Flag '--port' must be a positive integer" };
          }

          port = parsed;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = readLongFlagValue(argv, index, "--log-level");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { configPath, host, port, logLevel, errorMessage: parsedFlag.errorMessage };
          }

          const normalized = normalizeLogLevel(parsedFlag.value as string);

          if (normalized === null) {
            return {
              configPath,
              host,
              port,
              logLevel,
              errorMessage: "Flag '--log-level' must be one of: debug, info, warn, error"
            };
          }

          logLevel = normalized;
          index += parsedFlag.consumed;
          continue;
        }
      }

      return {
        configPath,
        host,
        port,
        logLevel,
        errorMessage: `Unknown flag '${arg}'`
      };
    }

    return { configPath, host, port, logLevel };
}

export function parseLogsTailArgs(
  argv: string[],
  readLongFlagValue: ReadLongFlagValue
): {
  follow: boolean;
  lines: number;
  since?: string;
  format: LogsFormat;
  route?: string;
  provider?: string;
  errorMessage?: string;
} {
    let follow = false;
    let lines = 50;
    let since: string | undefined;
    let format: LogsFormat = "text";
    let route: string | undefined;
    let provider: string | undefined;

    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];

      if (arg === "--follow") {
        follow = true;
        continue;
      }

      {
        const parsedFlag = readLongFlagValue(argv, index, "--lines");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { follow, lines, since, format, route, provider, errorMessage: parsedFlag.errorMessage };
          }

          const parsed = parseCanonicalNonNegativeInteger(parsedFlag.value);

          if (parsed === null) {
            return {
              follow,
              lines,
              since,
              format,
              route,
              provider,
              errorMessage: "Flag '--lines' must be a non-negative integer"
            };
          }

          lines = parsed;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = readLongFlagValue(argv, index, "--since");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { follow, lines, since, format, route, provider, errorMessage: parsedFlag.errorMessage };
          }

          const normalizedSince = normalizeJournalctlSinceValue(parsedFlag.value as string);

          if (normalizedSince === null) {
            return {
              follow,
              lines,
              since,
              format,
              route,
              provider,
              errorMessage:
                "Flag '--since' must be an ISO 8601 timestamp or a relative time like '5 minutes ago'"
            };
          }

          since = normalizedSince;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = readLongFlagValue(argv, index, "--format");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { follow, lines, since, format, route, provider, errorMessage: parsedFlag.errorMessage };
          }

          if (parsedFlag.value !== "text" && parsedFlag.value !== "json") {
            return {
              follow,
              lines,
              since,
              format,
              route,
              provider,
              errorMessage: "Flag '--format' must be either 'text' or 'json'"
            };
          }

          format = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = readLongFlagValue(argv, index, "--route");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { follow, lines, since, format, route, provider, errorMessage: parsedFlag.errorMessage };
          }

          route = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = readLongFlagValue(argv, index, "--provider");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return {
              follow,
              lines,
              since,
              format,
              route,
              provider,
              errorMessage: parsedFlag.errorMessage
            };
          }

          provider = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      return {
        follow,
        lines,
        since,
        format,
        route,
        provider,
        errorMessage: `Unknown flag '${arg}'`
      };
    }

    if (follow && format === "json") {
      return {
        follow,
        lines,
        since,
        format,
        route,
        provider,
        errorMessage: "Flag combination '--follow --format json' is not supported yet"
      };
    }

    return {
      follow,
      lines,
      since,
      format,
      route,
      provider
    };
}

function getJournalMessage(rawLine: string, format: LogsFormat): string | null {
  if (format === "text") {
    return rawLine;
  }

  try {
    const parsed = JSON.parse(rawLine) as { MESSAGE?: unknown };
    return typeof parsed.MESSAGE === "string" ? parsed.MESSAGE : rawLine;
  } catch {
    return rawLine;
  }
}

export function matchesLogFilters(
  rawLine: string,
  format: LogsFormat,
  route?: string,
  provider?: string
): boolean {
  const message = getJournalMessage(rawLine, format) ?? rawLine;

  if (route && !message.includes(`route=${route}`) && !message.includes(` ${route} `)) {
    return false;
  }

  if (provider && !message.includes(`provider=${provider}`) && !message.includes(` ${provider} `)) {
    return false;
  }

  return true;
}
