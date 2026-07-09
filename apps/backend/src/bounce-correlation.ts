export interface BounceCandidateMessage {
  id: string;
  recipient: string | null;
  subject: string | null;
  sentAt: string;
}

export interface BounceReport {
  recipientEmail: string;
  subjectExcerpt?: string;
  bounceReceivedAt: string;
}

export interface BounceCorrelationResult {
  matchedMsgId: string | null;
  reason: string;
}

/** Bounces arrive after sending but rarely more than a few days later; wider than that risks matching an unrelated later send to the same address. */
export const MAX_BOUNCE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Correlates a detected bounce notification to the specific tracked message
 * it belongs to. Pure and testable — see PLAN.md ADR-20. There is no shared
 * ID between a bounce notification and the original send (Gmail's bounce
 * format doesn't echo one back in a way InboxSDK exposes), so this is
 * necessarily heuristic: recipient-address match, narrowed by sent_at being
 * before the bounce and within a plausible delay window, then by subject
 * excerpt if more than one candidate remains. When the result is still
 * ambiguous, returns `matchedMsgId: null` with an honest reason rather than
 * guessing — a wrong bounce match would falsely tell a sender their email
 * never arrived, which is worse than not flagging it at all.
 */
export function correlateBounce(candidates: BounceCandidateMessage[], report: BounceReport): BounceCorrelationResult {
  const bouncedEmail = report.recipientEmail.trim().toLowerCase();
  const receivedAtMs = new Date(report.bounceReceivedAt).getTime();

  const recipientMatches = candidates.filter((c) => {
    if (!c.recipient) return false;
    if (!c.recipient.toLowerCase().includes(bouncedEmail)) return false;
    const sentAtMs = new Date(c.sentAt).getTime();
    if (sentAtMs > receivedAtMs) return false; // sent after the bounce arrived: can't be the cause
    if (receivedAtMs - sentAtMs > MAX_BOUNCE_DELAY_MS) return false;
    return true;
  });

  if (recipientMatches.length === 0) {
    return { matchedMsgId: null, reason: `No tracked message to ${report.recipientEmail} was found in the ${MAX_BOUNCE_DELAY_MS / 86_400_000}-day window before this bounce arrived.` };
  }

  if (recipientMatches.length === 1) {
    const only = recipientMatches[0]!;
    return {
      matchedMsgId: only.id,
      reason: `Matched by recipient address (${report.recipientEmail}) — the only tracked send to this address in the plausible bounce window.`,
    };
  }

  // More than one candidate: narrow by subject excerpt if we have one to work with.
  if (report.subjectExcerpt) {
    const excerpt = report.subjectExcerpt.trim().toLowerCase();
    const subjectMatches = recipientMatches.filter((c) => c.subject && c.subject.trim().toLowerCase().includes(excerpt));
    if (subjectMatches.length === 1) {
      const only = subjectMatches[0]!;
      return {
        matchedMsgId: only.id,
        reason: `Matched by recipient address and subject excerpt — ${recipientMatches.length} sends to ${report.recipientEmail} existed in the window, but only one had a matching subject.`,
      };
    }
  }

  // Still ambiguous: multiple sends to the same address in the window, no way to tell which one bounced. Honest non-match rather than a guess.
  return {
    matchedMsgId: null,
    reason: `${recipientMatches.length} tracked sends to ${report.recipientEmail} exist in the plausible bounce window and could not be disambiguated — withholding a match rather than guessing which one bounced.`,
  };
}
