/**
 * Pure detection of two engagement patterns from a message's full,
 * sorted-ascending list of verified-open timestamps. No DB/network —
 * unit-tested in isolation, same discipline as open-analysis.ts.
 */

/** 3+ opens within this window of the latest one reads as active, right-now engagement. */
export const HOT_CONVERSATION_WINDOW_MS = 60 * 60 * 1000;
export const HOT_CONVERSATION_MIN_OPENS = 3;

/** A gap this long since the previous open means the latest one is a genuine "coming back to it" after going dormant, not routine re-engagement. */
export const REVIVAL_DORMANT_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** True when the most recent open is the Nth (or later) within HOT_CONVERSATION_WINDOW_MS of itself — active engagement happening right now. */
export function isHotConversation(allOpenTimestampsSorted: string[]): boolean {
  if (allOpenTimestampsSorted.length < HOT_CONVERSATION_MIN_OPENS) return false;
  const latestMs = new Date(allOpenTimestampsSorted[allOpenTimestampsSorted.length - 1]!).getTime();
  const withinWindow = allOpenTimestampsSorted.filter((ts) => latestMs - new Date(ts).getTime() <= HOT_CONVERSATION_WINDOW_MS);
  return withinWindow.length >= HOT_CONVERSATION_MIN_OPENS;
}

/** True when the most recent open arrived REVIVAL_DORMANT_THRESHOLD_MS or more after the one before it — a dormant thread just came back to life. */
export function isRevival(allOpenTimestampsSorted: string[]): boolean {
  if (allOpenTimestampsSorted.length < 2) return false;
  const latestMs = new Date(allOpenTimestampsSorted[allOpenTimestampsSorted.length - 1]!).getTime();
  const previousMs = new Date(allOpenTimestampsSorted[allOpenTimestampsSorted.length - 2]!).getTime();
  return latestMs - previousMs >= REVIVAL_DORMANT_THRESHOLD_MS;
}
