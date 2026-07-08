/**
 * User-agent fingerprint filter.
 *
 * GoogleImageProxy is a *positive* signal here, not a negative one: Gmail
 * fetches remote images through this proxy at render time (when the message
 * is actually opened), not at delivery time. Combined with the timing filter
 * (a GoogleImageProxy fetch OUTSIDE the prefetch window is a strong human
 * signal), this is one of the most reliable checks we have.
 *
 * These patterns are heuristics seeded from public documentation of each
 * vendor's scanning infrastructure; they are expected to be refined against
 * real-device fixtures in M2 (see PLAN.md Known Issues).
 */

export type UserAgentClass = 'gmail_proxy' | 'known_scanner' | 'generic_bot' | 'browser_like' | 'unknown';

const SCANNER_PATTERNS: RegExp[] = [
  /proofpoint/i,
  /mimecast/i,
  /barracuda/i,
  /symantec/i,
  /forcepoint/i,
  /ms-office/i, // Outlook Safe Links / ATP pre-scan
  /microsoft office/i,
  /exchangeonline/i,
];

const BOT_PATTERNS: RegExp[] = [/bot/i, /crawler/i, /spider/i, /curl\//i, /wget/i, /python-requests/i, /go-http-client/i];

export function classifyUserAgent(userAgent: string | null): UserAgentClass {
  if (!userAgent) return 'unknown';
  if (/GoogleImageProxy/i.test(userAgent)) return 'gmail_proxy';
  if (SCANNER_PATTERNS.some((p) => p.test(userAgent))) return 'known_scanner';
  if (BOT_PATTERNS.some((p) => p.test(userAgent))) return 'generic_bot';
  if (/Mozilla|AppleWebKit|Chrome|Safari|Firefox/i.test(userAgent)) return 'browser_like';
  return 'unknown';
}
