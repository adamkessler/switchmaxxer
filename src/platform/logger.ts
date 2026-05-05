import { AsyncLocalStorage } from "node:async_hooks";

import { getEnvValue } from "./env";
import { REDACTED_SECRET } from "./secret-string";
import { normalizeLogLevel, type LogLevel } from "./types";

const DEFAULT_LOG_VALUE_MAX_LEN = 256;
const DEFAULT_LOG_MESSAGE_MAX_LEN = 4096;
const DEFAULT_REDACTION_INPUT_MAX_LEN = 8 * 1024;
const LOG_TRUNCATED_MARKER = " ...[truncated]";
const LOG_LEVEL_RANKS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

let processLogLevel: LogLevel | null = null;
let runtimeLogLevelOverride: LogLevel | null = null;
const defaultStdoutWriter = (message: string): void => {
  process.stdout.write(message);
};
const defaultStderrWriter = (message: string): void => {
  process.stderr.write(message);
};

type LoggerContext = {
  stdoutWriter?: (message: string) => void;
  stderrWriter?: (message: string) => void;
  effectiveLogLevel?: LogLevel;
  logLevelOverride?: LogLevel | null;
};

const loggerContextStorage = new AsyncLocalStorage<LoggerContext>();

function timestamp(): string {
  return new Date().toISOString();
}

function currentLogLevel(): LogLevel {
  const context = loggerContextStorage.getStore();

  if (typeof context?.logLevelOverride !== "undefined" && context.logLevelOverride !== null) {
    return context.logLevelOverride;
  }

  if (typeof context?.effectiveLogLevel !== "undefined") {
    return context.effectiveLogLevel;
  }

  if (runtimeLogLevelOverride !== null) {
    return runtimeLogLevelOverride;
  }

  return resolveProcessLogLevel();
}

function resolveProcessLogLevel(): LogLevel {
  if (processLogLevel === null) {
    processLogLevel = normalizeLogLevel(getEnvValue("SWITCHMAXXER_LOG_LEVEL")) ?? "info";
  }

  return processLogLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_RANKS[level] >= LOG_LEVEL_RANKS[currentLogLevel()];
}

export function logLine(message: string): void {
  if (!shouldLog("info")) {
    return;
  }
  const stdoutWriter = loggerContextStorage.getStore()?.stdoutWriter ?? defaultStdoutWriter;
  stdoutWriter(`[${timestamp()}] ${sanitizeLogMessage(message)}\n`);
}

export function logWarning(message: string): void {
  if (!shouldLog("warn")) {
    return;
  }
  const stderrWriter = loggerContextStorage.getStore()?.stderrWriter ?? defaultStderrWriter;
  stderrWriter(formatMultilineLog("! WARNING   ", message));
}

export function logError(message: string): void {
  if (!shouldLog("error")) {
    return;
  }
  const stderrWriter = loggerContextStorage.getStore()?.stderrWriter ?? defaultStderrWriter;
  stderrWriter(`[${timestamp()}] ! ERROR     ${sanitizeLogMessage(message)}\n`);
}

export function logDebug(message: string): void {
  if (!shouldLog("debug")) {
    return;
  }
  const stdoutWriter = loggerContextStorage.getStore()?.stdoutWriter ?? defaultStdoutWriter;
  stdoutWriter(`[${timestamp()}] .. DEBUG    ${sanitizeLogMessage(message)}\n`);
}

export async function withLogWriters<T>(
  writers: {
    stdout?: (message: string) => void;
    stderr?: (message: string) => void;
  },
  fn: () => Promise<T> | T
): Promise<T> {
  const currentContext = loggerContextStorage.getStore() ?? {};
  const nextContext: LoggerContext = {
    ...currentContext,
    stdoutWriter: typeof writers.stdout === "function" ? writers.stdout : currentContext.stdoutWriter,
    stderrWriter: typeof writers.stderr === "function" ? writers.stderr : currentContext.stderrWriter,
    effectiveLogLevel:
      typeof currentContext.effectiveLogLevel !== "undefined" ? currentContext.effectiveLogLevel : currentLogLevel(),
    logLevelOverride:
      typeof currentContext.logLevelOverride !== "undefined" ? currentContext.logLevelOverride : runtimeLogLevelOverride
  };

  return await loggerContextStorage.run(nextContext, async () => await fn());
}

export function isDebugLoggingEnabled(): boolean {
  return currentLogLevel() === "debug";
}

export function setRuntimeLogLevelOverride(level: LogLevel | null): void {
  const context = loggerContextStorage.getStore();

  if (context) {
    context.logLevelOverride = level;
    return;
  }

  runtimeLogLevelOverride = level;
}

export function setProcessLogLevel(level: LogLevel): void {
  const context = loggerContextStorage.getStore();

  if (context) {
    context.effectiveLogLevel = level;
    return;
  }

  processLogLevel = level;
}

export function resetProcessLogLevel(): void {
  const context = loggerContextStorage.getStore();

  if (context) {
    delete context.effectiveLogLevel;
    return;
  }

  processLogLevel = null;
}

function truncateLogText(value: string, maxLen: number): string {
  if (value.length <= maxLen) {
    return value;
  }

  if (maxLen <= LOG_TRUNCATED_MARKER.length) {
    return LOG_TRUNCATED_MARKER.slice(0, maxLen);
  }

  return `${value.slice(0, maxLen - LOG_TRUNCATED_MARKER.length)}${LOG_TRUNCATED_MARKER}`;
}

export function sanitizeLogValue(value: string, maxLen = DEFAULT_LOG_VALUE_MAX_LEN): string {
  return truncateLogText(value.replace(/[\r\n\t\x00-\x1f\x7f-\x9f]/g, " "), maxLen);
}

export function redactSensitiveText(value: string): string {
  const truncated = value.length > DEFAULT_REDACTION_INPUT_MAX_LEN;
  const input = truncated ? value.slice(0, DEFAULT_REDACTION_INPUT_MAX_LEN) : value;
  const redacted = input
    .replace(/\bAuthorization:\s*(Basic|Token|ApiKey)\s+\S+/gi, `Authorization: $1 ${REDACTED_SECRET}`)
    .replace(/\bAuthorization:\s*Digest\b[^\r\n]{0,512}/gi, `Authorization: Digest ${REDACTED_SECRET}`)
    .replace(/Bearer\s+[A-Za-z0-9._\-~+/=]+/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b/g, REDACTED_SECRET)
    .replace(/\b(?:sk|ak)-[A-Za-z0-9._\-~+/=]+\b/g, REDACTED_SECRET)
    .replace(/\b(?:xox[baprs]-[A-Za-z0-9-]{12,}|gh[oprsu]_[A-Za-z0-9_]{16,}|hf_[A-Za-z0-9]{16,}|xai-[A-Za-z0-9._\-~+/=]{16,}|AIza[0-9A-Za-z\-_]{16,}|AKIA[0-9A-Z]{16})\b/g, REDACTED_SECRET)
    .replace(
      /\b([A-Za-z_][A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|bearer[_-]?token|token|secret|digest|signature|sig)[A-Za-z0-9_-]*\b\s*[:=]\s*)([A-Za-z0-9._\-~+/=]{16,})/gi,
      `$1${REDACTED_SECRET}`
    )
    .replace(/\b(api[_-]?key|token|secret|digest|signature)=([a-f0-9]{64})\b/gi, `$1=${REDACTED_SECRET}`)
    .replace(/([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|bearer[_-]?token|client[_-]?secret|secret|signature|sig|token)=)([^&#\s]+)/gi, `$1${REDACTED_SECRET}`)
    .replace(/(https?:\/\/)([^:\s/@]+):([^@\s/]+)@/gi, `$1${REDACTED_SECRET}:${REDACTED_SECRET}@`);

  return truncated ? `${redacted}${LOG_TRUNCATED_MARKER}` : redacted;
}

export function redactAbsolutePaths(value: string): string {
  const sanitizePathLikeToken = (token: string): string => {
    const match = token.match(/^([("'`[]*)(.*?)([)\]"'`.,:;!?]*)$/);
    const leading = match?.[1] ?? "";
    const core = match?.[2] ?? token;
    const trailing = match?.[3] ?? "";

    const looksLikeFileUrl = core.startsWith("file://");
    const looksLikeWindowsAbsolutePath = /^[A-Za-z]:\\/.test(core);
    const looksLikeUnixAbsolutePath = core.startsWith("/");

    if (!looksLikeFileUrl && !looksLikeWindowsAbsolutePath && !looksLikeUnixAbsolutePath) {
      return token;
    }

    return `${leading}<path>${trailing}`;
  };

  return value
    .split(/\s+/)
    .map((token) => sanitizePathLikeToken(token))
    .join(" ")
    .trim();
}

export function safeErrorMessage(error: unknown, maxLen = DEFAULT_LOG_VALUE_MAX_LEN): string {
  if (error instanceof Error) {
    return sanitizeLogValue(redactAbsolutePaths(redactSensitiveText(error.message)), maxLen);
  }

  return sanitizeLogValue(redactAbsolutePaths(redactSensitiveText(String(error))), maxLen);
}

function sanitizeLogMessage(message: string, maxLen = DEFAULT_LOG_MESSAGE_MAX_LEN): string {
  return sanitizeLogValue(redactSensitiveText(message), maxLen);
}

function formatMultilineLog(prefix: string, message: string): string {
  const lines = message.split("\n");
  const firstLine = lines[0] ?? "";
  const continuationIndent = "  ";
  const rendered = lines
    .slice(1)
    .map((line) => `${continuationIndent}${sanitizeLogMessage(line)}`)
    .join("\n");

  return rendered.length > 0
    ? `[${timestamp()}] ${prefix}${sanitizeLogMessage(firstLine)}\n${rendered}\n`
    : `[${timestamp()}] ${prefix}${sanitizeLogMessage(firstLine)}\n`;
}

export function logStartup(appVersion: string, bindHost: string, port: number, routeCount: number, sourcePath: string): void {
  logLine(`Switchmaxxer Gateway v${appVersion} started on ${bindHost}:${port}`);
  logLine(`Loaded ${routeCount} route(s) from ${sourcePath}`);

  if (currentLogLevel() === "debug") {
    logDebug(`SWITCHMAXXER_LOG_LEVEL=debug  source_path=${sourcePath}`);
  }
}
