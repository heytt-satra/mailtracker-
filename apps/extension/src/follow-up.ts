import type { MessageSummary } from '@mailtrack/shared';

/** No verified open after this long since send — worth a nudge. */
export const NOT_OPENED_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;
/** Opened (or clicked) but no reply after this long since the last verified activity. */
export const OPENED_NO_REPLY_THRESHOLD_MS = 5 * 24 * 60 * 60 * 1000;

export type FollowUpReason = 'not_opened' | 'opened_no_reply';

export interface FollowUpSuggestion {
  reason: FollowUpReason;
  text: string;
}

/**
 * Pure, derived from data MailTrack already tracks — no new signal, no new
 * tracking mechanism. Deliberately conservative: a bounce means the message
 * never arrived (nothing to "follow up" on until it's resent), a reply means
 * the loop is already closed, and `not_verifiable` means we genuinely don't
 * know what happened — nudging the sender based on a guess would violate the
 * same "never fabricate" principle the read-confidence tiers are built on.
 */
export function getFollowUpSuggestion(message: MessageSummary, nowMs: number): FollowUpSuggestion | null {
  if (message.bounce || message.reply || message.status === 'not_verifiable') return null;

  const sentMs = new Date(message.sentAt).getTime();

  if (message.status === 'sent' || message.status === 'delivered') {
    const elapsedMs = nowMs - sentMs;
    if (elapsedMs < NOT_OPENED_THRESHOLD_MS) return null;
    const days = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
    return { reason: 'not_opened', text: `Not opened in ${days} day${days === 1 ? '' : 's'} — consider a follow-up.` };
  }

  if (message.status === 'opened' || message.status === 'clicked') {
    const lastActivityMs = new Date(message.lastOpenedAt ?? message.sentAt).getTime();
    const elapsedMs = nowMs - lastActivityMs;
    if (elapsedMs < OPENED_NO_REPLY_THRESHOLD_MS) return null;
    const days = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
    return { reason: 'opened_no_reply', text: `Opened ${days} day${days === 1 ? '' : 's'} ago, no reply yet — consider following up.` };
  }

  return null; // 'replied' status is already excluded via message.reply above
}
