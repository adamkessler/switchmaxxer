const RETENTION_DURATION_UNITS = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000
} as const;

const RETENTION_DURATION_PATTERN = /^([1-9]\d*)([mhdw])$/;
const MAX_RETENTION_DURATION_MS = 10 * 365 * 24 * 60 * 60_000;
const RETENTION_DURATION_USAGE_MESSAGE =
  "Retention duration must be one of <number>m, <number>h, <number>d, or <number>w, up to 10 years.";

export function parseRetentionDurationMs(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  const match = RETENTION_DURATION_PATTERN.exec(normalized);

  if (match === null) {
    return null;
  }

  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2] as keyof typeof RETENTION_DURATION_UNITS;
  const multiplier = RETENTION_DURATION_UNITS[unit];

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const durationMs = amount * multiplier;

  if (!Number.isSafeInteger(durationMs) || durationMs > MAX_RETENTION_DURATION_MS) {
    return null;
  }

  return durationMs;
}

export function isRetentionDurationString(value: unknown): value is string {
  return typeof value === "string" && parseRetentionDurationMs(value) !== null;
}

export function retentionDurationToCutoffIso(value: string, now = new Date()): string {
  const durationMs = parseRetentionDurationMs(value);

  if (durationMs === null) {
    throw new Error(RETENTION_DURATION_USAGE_MESSAGE);
  }

  return new Date(now.getTime() - durationMs).toISOString();
}
