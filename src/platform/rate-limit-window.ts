export function parseRateLimitWindowMs(value: string): number | null {
  const match = /^([1-9]\d*)(ms|s|m|h)$/i.exec(value.trim());

  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1_000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 60 * 60_000;
    default:
      return null;
  }
}
