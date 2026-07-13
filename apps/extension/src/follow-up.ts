import type { MessageSummary } from '@mailtrack/shared';

/** Defaults, used when the user hasn't customized their follow-up thresholds in settings. */
export const DEFAULT_NOT_OPENED_THRESHOLD_DAYS = 3;
export const DEFAULT_OPENED_NO_REPLY_THRESHOLD_DAYS = 5;

export type FollowUpReason = 'not_opened' | 'opened_no_reply';

export interface FollowUpSuggestion {
  reason: FollowUpReason;
  text: string;
}

export interface FollowUpThresholds {
  /** Days since send with no verified open before it's worth a nudge. */
  notOpenedDays: number;
  /** Days since the last verified activity (open/click) with no reply before it's worth a nudge. */
  openedNoReplyDays: number;
}

/**
 * Pure, derived from data MailTrack already tracks — no new signal, no new
 * tracking mechanism. Deliberately conservative: a bounce means the message
 * never arrived (nothing to "follow up" on until it's resent), a reply means
 * the loop is already closed, and `not_verifiable` means we genuinely don't
 * know what happened — nudging the sender based on a guess would violate the
 * same "never fabricate" principle the read-confidence tiers are built on.
 *
 * Thresholds are caller-supplied (user-configurable in settings) rather than
 * fixed constants — see storage.ts's MailTrackSettings.followUpThresholds.
 */
export function getFollowUpSuggestion(message: MessageSummary, nowMs: number, thresholds: FollowUpThresholds): FollowUpSuggestion | null {
  if (message.bounce || message.reply || message.status === 'not_verifiable') return null;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const sentMs = new Date(message.sentAt).getTime();

  if (message.status === 'sent' || message.status === 'delivered') {
    const elapsedMs = nowMs - sentMs;
    if (elapsedMs < thresholds.notOpenedDays * DAY_MS) return null;
    const days = Math.floor(elapsedMs / DAY_MS);
    return { reason: 'not_opened', text: `Not opened in ${days} day${days === 1 ? '' : 's'} — consider a follow-up.` };
  }

  if (message.status === 'opened' || message.status === 'clicked') {
    const lastActivityMs = new Date(message.lastOpenedAt ?? message.sentAt).getTime();
    const elapsedMs = nowMs - lastActivityMs;
    if (elapsedMs < thresholds.openedNoReplyDays * DAY_MS) return null;
    const days = Math.floor(elapsedMs / DAY_MS);
    return { reason: 'opened_no_reply', text: `Opened ${days} day${days === 1 ? '' : 's'} ago, no reply yet — consider following up.` };
  }

  return null; // 'replied' status is already excluded via message.reply above
}
