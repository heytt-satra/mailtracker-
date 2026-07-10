import type { MessageStatus, Verdict } from '@mailtrack/shared';

/**
 * The escalation ladder. This is the mechanism that makes "we never
 * fabricate engagement" true rather than aspirational: a message's status
 * can only move to a MORE confident state, never back down, and a verdict
 * that reduces confidence (e.g. a later machine_suspect fetch after a
 * verified open) is recorded in the timeline but never changes status.
 *
 * Rank order: sent < delivered == not_verifiable < opened < clicked < replied.
 * `not_verifiable` sits alongside `delivered` in rank (it is not "worse"
 * than delivered, just a more informative reason why we're stuck there) but
 * can still be superseded by a later opened/clicked verdict — Apple Mail
 * Privacy Protection relaying a fetch doesn't prove a human never opened
 * the email later through a channel we CAN verify (e.g. a link click).
 * `replied` (ADR-21) is the top rank: a reply is definitive proof of a human
 * read, stronger than any pixel or click signal.
 */

const RANK: Record<MessageStatus, number> = {
  sent: 0,
  delivered: 1,
  not_verifiable: 1,
  opened: 2,
  clicked: 3,
  replied: 4,
};

export function verdictToStatus(verdict: Verdict): MessageStatus {
  switch (verdict) {
    case 'verified_click':
      return 'clicked';
    case 'verified_open':
      return 'opened';
    case 'not_verifiable':
      return 'not_verifiable';
    case 'machine_suspect':
      return 'delivered';
  }
}

/** Applies the escalate-only ladder. Never returns a status ranked below `current`. */
export function nextStatus(current: MessageStatus, verdict: Verdict): MessageStatus {
  const candidate = verdictToStatus(verdict);
  return RANK[candidate] > RANK[current] ? candidate : current;
}
