import { createStringKeyRecord, isReservedObjectKey, setSafeObjectKey } from "./object-key-policy";
import { isRecord } from "./type-guards";

function normalizeParsedLogValue(value: string): string | number | boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (/^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) {
      return parsed;
    }
  }

  if (/^-?\d+ms$/.test(value)) {
    return Number(value.slice(0, -2));
  }

  return value;
}

function normalizeParsedLogKey(key: string): string {
  switch (key) {
    case "latency":
      return "latency_ms";
    case "total_time":
      return "total_time_ms";
    case "status":
      return "status_code";
    default:
      return key;
  }
}

function inferLogEvent(message: string): string {
  if (message.includes("--> REQUEST")) {
    return "request";
  }

  if (message.includes("--> FORWARD")) {
    return "forward";
  }

  if (message.includes("<-- UPSTREAM")) {
    return "upstream";
  }

  if (message.includes("<-- RESPONSE")) {
    return "response";
  }

  if (message.includes("! WARNING")) {
    return "warning";
  }

  if (message.includes("x ERROR")) {
    return "error";
  }

  return "log";
}

export function normalizeJournalJsonEntry(rawLine: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawLine) as unknown;
    if (!isRecord(parsed)) {
      return {
        event: "log",
        message: rawLine
      };
    }

    const message = typeof parsed["MESSAGE"] === "string" ? parsed["MESSAGE"] : rawLine;
    const timestampMatch = message.match(/^\[([^\]]+)\]\s*/);
    const timestamp = timestampMatch?.[1] ?? null;
    const body = timestampMatch ? message.slice(timestampMatch[0].length) : message;
    const inferredEvent = inferLogEvent(body);
    const fields = createStringKeyRecord<string | number | boolean>();

    for (const match of body.matchAll(/([a-z][a-z0-9_]*)=("[^"]*"|[^ \t]+)/g)) {
      const rawValue = match[2];
      const rawKey = match[1];
      if (typeof rawKey !== "string" || typeof rawValue !== "string") {
        continue;
      }
      const key = normalizeParsedLogKey(rawKey);
      if (isReservedObjectKey(key)) {
        continue;
      }
      const unquoted =
        rawValue.startsWith("\"") && rawValue.endsWith("\"") ? rawValue.slice(1, -1) : rawValue;
      setSafeObjectKey(fields, key, normalizeParsedLogValue(unquoted), "Journal log field");
    }

    const normalized = createStringKeyRecord<unknown>();
    normalized["timestamp"] = timestamp;
    normalized["event"] = inferredEvent;
    normalized["message"] = body;

    if (typeof parsed["SYSLOG_IDENTIFIER"] === "string") {
      normalized["syslog_identifier"] = parsed["SYSLOG_IDENTIFIER"];
    }

    if (typeof parsed["_PID"] === "string" && /^-?\d+$/.test(parsed["_PID"])) {
      normalized["pid"] = Number(parsed["_PID"]);
    }

    if (typeof parsed["_HOSTNAME"] === "string") {
      normalized["hostname"] = parsed["_HOSTNAME"];
    }

    if (typeof parsed["_TRANSPORT"] === "string") {
      normalized["transport"] = parsed["_TRANSPORT"];
    }

    if (typeof parsed["__REALTIME_TIMESTAMP"] === "string") {
      normalized["journal_realtime_timestamp"] = parsed["__REALTIME_TIMESTAMP"];
    }

    for (const [key, value] of Object.entries(fields)) {
      if (isReservedObjectKey(key)) {
        continue;
      }
      setSafeObjectKey(normalized, key, value, "Journal log field");
    }

    return normalized;
  } catch {
    return {
      timestamp: null,
      event: "log",
      message: rawLine
    };
  }
}
