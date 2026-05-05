import { isRetentionDurationString } from "../../platform/retention-duration";

export const PRUNE_OLDER_THAN_MESSAGE =
  "duration like '14d', '168h', '30m', or '2w'";

export function validatePruneOlderThan(olderThan: string | undefined): string | null {
  if (typeof olderThan === "undefined") {
    return null;
  }

  return isRetentionDurationString(olderThan) ? null : PRUNE_OLDER_THAN_MESSAGE;
}
