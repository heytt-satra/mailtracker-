/**
 * Pure analysis of a message's verified-open timestamps, per PLAN.md ADR-22.
 * No DB/network — unit-tested in isolation.
 *
 * Two related but distinct jobs:
 *  - clusterOpenSessions: collapse rapid re-fetches into distinct *viewing
 *    sessions*. Gmail (and mail apps generally) can fire several pixel
 *    fetches for a single time a human looks at a message; counting each as
 *    a separate "open" overstates engagement. Opens closer together than
 *    SESSION_GAP_MS belong to one session — so "5 opens" honestly becomes
 *    e.g. "3 sessions", and a mail app polling every few minutes collapses
 *    into one session rather than inflating the count.
 *  - detectSyncPattern: the harder case — an automated mail sync that polls
 *    on a *fixed schedule* wider than the session gap (e.g. every 45 min)
 *    would otherwise register as many separate sessions and look like a
 *    human repeatedly returning. Real human re-opens are irregular; a daemon
 *    is clockwork. Flagging a suspiciously regular series lets us caveat the
 *    signal honestly rather than present it as confident repeat-engagement.
 */

/** Opens within this window of each other are the same viewing session. 30 min balances "same sitting" against "genuinely came back". */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/** Groups sorted-ascending open timestamps into sessions. Input need not be pre-sorted. */
export function clusterOpenSessions(openTimestamps: string[]): string[][] {
  const sorted = [...openTimestamps].sort();
  const sessions: string[][] = [];
  for (const ts of sorted) {
    const current = sessions[sessions.length - 1];
    if (current && new Date(ts).getTime() - new Date(current[current.length - 1]!).getTime() <= SESSION_GAP_MS) {
      current.push(ts);
    } else {
      sessions.push([ts]);
    }
  }
  return sessions;
}

export interface SyncPatternResult {
  suspect: boolean;
  reason: string | null;
}

/** Minimum opens before regularity is even meaningful — two points are always "evenly spaced". */
const MIN_OPENS_FOR_SYNC = 3;
/** Coefficient of variation (stddev/mean of intervals) below this reads as machine-regular rather than human-irregular. */
const REGULARITY_CV_THRESHOLD = 0.15;

export function detectSyncPattern(openTimestamps: string[]): SyncPatternResult {
  const sorted = [...openTimestamps].sort().map((t) => new Date(t).getTime());
  if (sorted.length < MIN_OPENS_FOR_SYNC) return { suspect: false, reason: null };

  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i]! - sorted[i - 1]!);

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean <= 0) return { suspect: false, reason: null };
  // Intervals within the session gap are just one sitting's re-renders, not a
  // cross-session polling cadence — don't flag those as an automated sync.
  if (mean <= SESSION_GAP_MS) return { suspect: false, reason: null };

  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  const cv = Math.sqrt(variance) / mean;

  if (cv < REGULARITY_CV_THRESHOLD) {
    const minutes = Math.round(mean / 60000);
    return {
      suspect: true,
      reason: `opens arrived at near-regular ~${minutes}-minute intervals, a pattern more consistent with an automated mail sync than with a human reopening the message`,
    };
  }
  return { suspect: false, reason: null };
}
