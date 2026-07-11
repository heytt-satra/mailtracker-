/**
 * Timing filter.
 *
 * Apple Mail Privacy Protection and security scanners fetch tracking pixels
 * within seconds of delivery. A human very rarely opens an email that fast.
 * This is a necessary-but-not-sufficient signal: combined with UA/ASN/burst
 * checks in rules.ts, not used alone.
 */

/** Fetches inside this window, if also the first fetch for the message, are prefetch-suspect. */
export const PREFETCH_WINDOW_MS = 45_000;

export function isWithinPrefetchWindow(fetchSequenceMs: number): boolean {
  return fetchSequenceMs <= PREFETCH_WINDOW_MS;
}

// ADR-33 added a GMAIL_PROXY_CACHING_WINDOW_MS here to suppress Gmail's own
// image-proxy pre-caching (confirmed real via live data — every test
// message showed 2-4 GoogleImageProxy fetches 10-135s after send regardless
// of human action). Reverted the same day: a pure timing window can't
// actually distinguish that caching burst from a genuinely fast human open,
// since both look identical (same UA, same rough post-send timeframe), and
// blocking the common "opened within a few minutes" case was a worse
// failure than the false positive it targeted. Left as an open problem —
// see PLAN.md ADR-33/34 — rather than shipping a heuristic the data doesn't
// actually support.
