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
