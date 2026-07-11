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

/**
 * Gmail's own image proxy (ggpht.com GoogleImageProxy) fetches a new
 * message's remote images automatically shortly after delivery, entirely
 * independent of whether the recipient ever opens it — its own version of
 * the same problem Apple MPP causes, just on a longer and less predictable
 * timeline than PREFETCH_WINDOW_MS assumes. Confirmed empirically against
 * live production data (2026-07-11): every single test message showed 2-4
 * GoogleImageProxy fetches landing 10-135s after send, with zero exception,
 * regardless of whether any human plausibly opened it that fast — a pattern
 * far too consistent to be human read-timing variance. 5 minutes gives
 * comfortable margin over the observed ~135s ceiling while still resolving
 * within a reasonable time for a genuinely fast human open (which shows up
 * as a later, non-bursty repeat fetch once this window passes).
 */
export const GMAIL_PROXY_CACHING_WINDOW_MS = 5 * 60 * 1000;

export function isWithinGmailProxyCachingWindow(fetchSequenceMs: number): boolean {
  return fetchSequenceMs <= GMAIL_PROXY_CACHING_WINDOW_MS;
}
