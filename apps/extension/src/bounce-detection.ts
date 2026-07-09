import type { Contact } from './inboxsdk-types';

/**
 * Pure, DOM-free detection of Gmail's own bounce-notification format
 * ("Mail Delivery Subsystem" / mailer-daemon), per PLAN.md ADR-20. Kept
 * separate from the InboxSDK wiring in inboxsdk-app.ts so the extraction
 * logic is unit-testable without a real Gmail DOM.
 *
 * This only recognizes Gmail's own, well-documented bounce format
 * (RFC-3464-style, "Delivery to the following recipient failed
 * permanently") — it is a heuristic based on real, observed Gmail output,
 * not a guarantee for every possible mail-server bounce phrasing. A miss
 * (a bounce that isn't recognized) just means no bounce badge appears,
 * same fail-open posture as everything else in this product; it never
 * fabricates a match.
 */

/** Google's bounce sender address has used a few forms over the years; match the address, not the display name (which InboxSDK may or may not include). */
const BOUNCE_SENDER_PATTERN = /^(mailer-daemon|postmaster|mail-daemon)@/i;

export function isBounceSender(sender: Contact): boolean {
  return BOUNCE_SENDER_PATTERN.test(sender.emailAddress.trim());
}

/**
 * Only matches PERMANENT failures ("failed permanently"), never temporary
 * ones ("failed temporarily" — a soft bounce, e.g. recipient mailbox full or
 * a greylisting delay). A temporary failure is often retried and eventually
 * delivered; reporting it as a hard bounce would be exactly the kind of
 * false negative-turned-false-positive this product exists to avoid.
 */
const FAILED_RECIPIENT_PATTERN = /failed permanently:?\s*\n+\s*([^\s<>]+@[^\s<>]+)/i;

/** Gmail echoes the original message's headers back in a "----- Original message -----" block; Subject is one of them when present. */
const SUBJECT_PATTERN = /^\s*Subject:\s*(.+)$/im;

/** The literal SMTP-level rejection reason Gmail quotes — shown back to the sender as evidence, never used for matching. */
const DIAGNOSTIC_PATTERNS = [/error that the other server returned was:\s*(.+)/i, /(\b5\d{2}[- ]5\.\d\.\d\b[^\n]*)/];

export interface ExtractedBounceDetails {
  recipientEmail: string | null;
  subjectExcerpt: string | null;
  diagnostic: string | null;
}

export function extractBounceDetails(bodyText: string): ExtractedBounceDetails {
  const recipientMatch = bodyText.match(FAILED_RECIPIENT_PATTERN);
  const subjectMatch = bodyText.match(SUBJECT_PATTERN);
  const diagnosticMatch = DIAGNOSTIC_PATTERNS.map((p) => bodyText.match(p)).find(Boolean);

  return {
    recipientEmail: recipientMatch ? recipientMatch[1]!.trim() : null,
    subjectExcerpt: subjectMatch ? subjectMatch[1]!.trim() : null,
    diagnostic: diagnosticMatch ? diagnosticMatch[1]!.trim().slice(0, 300) : null,
  };
}
