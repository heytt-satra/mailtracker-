import type { ClassificationInput, ClassificationResult } from '@mailtrack/shared';
import { isWithinPrefetchWindow } from './timing';
import { classifyUserAgent } from './useragent';
import { classifyAsn } from './asn';

/** 5+ resource fetches within a 2s window is characteristic of an automated scanner, not a human. */
export const BURST_THRESHOLD = 5;

/**
 * Classifies a single raw fetch event. This is the core of the product's
 * differentiator: every one of these branches exists because a real
 * competitor (Mailsuite) gets it wrong and reports a false "read".
 *
 * Pure function, no I/O, so it can be tested exhaustively against fixtures
 * without a database or network — see tests/classifier.test.ts.
 */
export function classifyEvent(input: ClassificationInput): ClassificationResult {
  const { event, asnIntel, ipCategory, burstFetchCount, isFirstFetch } = input;

  const asnCategory = classifyAsn(asnIntel);
  const uaClass = classifyUserAgent(event.userAgent);

  // A link click usually IS a direct human action — but not always: several
  // corporate security gateways (Microsoft Safe Links, Proofpoint URL
  // Defense, Mimecast) rewrite links and then automatically pre-visit the
  // rewritten URL server-side to scan it, before the recipient ever opens
  // the email. That's the exact same false-positive shape as the pixel
  // problem, applied to clicks — so link clicks get the same scanner check
  // pixel fetches do. Apple Private Relay is deliberately NOT checked here
  // (unlike for pixel_fetch): Private Relay only proxies content the user's
  // own device actually requests, it does not auto-follow links in a
  // message body, so a click via a Private Relay egress IP is a normal
  // human click and should verify.
  if (event.kind === 'link_click') {
    if (asnCategory === 'security_scanner' || uaClass === 'known_scanner') {
      return {
        verdict: 'machine_suspect',
        reason: `Link pre-visited from a known security-scanner ${asnCategory === 'security_scanner' ? 'ASN' : 'user-agent'} — a mail gateway scan, not the recipient clicking.`,
      };
    }
    return { verdict: 'verified_click', reason: 'Link click with no scanner signal detected: a direct user action.' };
  }

  // IP-range match takes priority over ASN lookup for Apple MPP: relay
  // egress doesn't reliably map to a single ASN (ADR-8), so this is the more
  // trustworthy signal when both are available.
  if (ipCategory === 'apple_mpp') {
    return {
      verdict: 'not_verifiable',
      reason: 'Fetched from a published Apple Private Relay egress range; opens cannot be verified for this recipient.',
    };
  }

  if (burstFetchCount >= BURST_THRESHOLD) {
    return {
      verdict: 'machine_suspect',
      reason: `${burstFetchCount} resource fetches within 2s of delivery is a scanner burst pattern, not human reading behavior.`,
    };
  }

  if (asnCategory === 'apple_mpp') {
    return {
      verdict: 'not_verifiable',
      reason: 'Fetched via a known Apple Mail Privacy Protection ASN; opens cannot be verified for this recipient.',
    };
  }

  if (asnCategory === 'security_scanner') {
    return {
      verdict: 'machine_suspect',
      reason: 'Fetched from a known security-scanner ASN (mail gateway pre-scan), not the recipient.',
    };
  }

  if (uaClass === 'known_scanner' || uaClass === 'generic_bot') {
    return {
      verdict: 'machine_suspect',
      reason: `User-agent matches a known automated fetcher pattern ("${event.userAgent}").`,
    };
  }

  if (isFirstFetch && isWithinPrefetchWindow(event.fetchSequenceMs)) {
    return {
      verdict: 'machine_suspect',
      reason: `First fetch arrived ${Math.round(event.fetchSequenceMs / 1000)}s after send, inside the prefetch window; too fast to be a human read.`,
    };
  }

  // Gmail's own image proxy fetching outside the prefetch window, with no
  // burst pattern and no scanner signal, is the strongest available proxy
  // for "a human actually rendered this message."
  if (uaClass === 'gmail_proxy') {
    return {
      verdict: 'verified_open',
      reason: 'Fetched via Gmail image proxy outside the prefetch window, consistent with a human viewing the message.',
    };
  }

  // A repeat fetch (not the first) outside the prefetch window, from an
  // unclassified but non-bot user agent, is treated as a verified open —
  // this is what allows regression fixture 4 (delayed repeat fetch) to
  // escalate correctly even when the first fetch was machine_suspect.
  if (!isFirstFetch && !isWithinPrefetchWindow(event.fetchSequenceMs) && uaClass !== 'unknown') {
    return {
      verdict: 'verified_open',
      reason: 'Repeat fetch well after delivery, non-bot user agent, no burst pattern: consistent with a human read.',
    };
  }

  return {
    verdict: 'machine_suspect',
    reason: 'Insufficient positive signal to verify a human read; withholding "opened" rather than guessing.',
  };
}
