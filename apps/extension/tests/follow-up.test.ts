import { describe, expect, it } from 'vitest';
import { getFollowUpSuggestion, NOT_OPENED_THRESHOLD_MS, OPENED_NO_REPLY_THRESHOLD_MS } from '../src/follow-up';
import type { MessageSummary } from '@mailtrack/shared';

const NOW = new Date('2026-07-15T00:00:00.000Z').getTime();

function baseMessage(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    msgId: 'm1',
    subject: null,
    recipient: 'a@b.com',
    status: 'sent',
    sentAt: new Date(NOW).toISOString(),
    openCount: 0,
    clickCount: 0,
    firstOpenedAt: null,
    lastOpenedAt: null,
    readConfidence: null,
    minEngagedSeconds: null,
    readEvidence: null,
    depthReached: null,
    sessionCount: null,
    syncSuspect: false,
    bounce: null,
    reply: null,
    ...overrides,
  };
}

describe('getFollowUpSuggestion', () => {
  it('suggests a follow-up for an unopened message past the not-opened threshold', () => {
    const message = baseMessage({ status: 'sent', sentAt: new Date(NOW - NOT_OPENED_THRESHOLD_MS - 1000).toISOString() });
    const suggestion = getFollowUpSuggestion(message, NOW);
    expect(suggestion?.reason).toBe('not_opened');
    expect(suggestion?.text).toMatch(/not opened/i);
  });

  it('does not suggest a follow-up for an unopened message still inside the threshold', () => {
    const message = baseMessage({ status: 'delivered', sentAt: new Date(NOW - 1000).toISOString() });
    expect(getFollowUpSuggestion(message, NOW)).toBeNull();
  });

  it('suggests a follow-up for an opened-but-unreplied message past the opened-no-reply threshold', () => {
    const message = baseMessage({
      status: 'opened',
      sentAt: new Date(NOW - OPENED_NO_REPLY_THRESHOLD_MS - 2000).toISOString(),
      lastOpenedAt: new Date(NOW - OPENED_NO_REPLY_THRESHOLD_MS - 1000).toISOString(),
    });
    const suggestion = getFollowUpSuggestion(message, NOW);
    expect(suggestion?.reason).toBe('opened_no_reply');
    expect(suggestion?.text).toMatch(/no reply/i);
  });

  it('does not suggest a follow-up for a recently opened message', () => {
    const message = baseMessage({ status: 'clicked', sentAt: new Date(NOW - 1000).toISOString(), lastOpenedAt: new Date(NOW - 500).toISOString() });
    expect(getFollowUpSuggestion(message, NOW)).toBeNull();
  });

  it('never suggests a follow-up for a bounced message', () => {
    const message = baseMessage({
      status: 'sent',
      sentAt: new Date(NOW - NOT_OPENED_THRESHOLD_MS - 1000).toISOString(),
      bounce: { detectedAt: new Date(NOW).toISOString(), reason: 'address not found' },
    });
    expect(getFollowUpSuggestion(message, NOW)).toBeNull();
  });

  it('never suggests a follow-up once the recipient has replied', () => {
    const message = baseMessage({
      status: 'replied',
      sentAt: new Date(NOW - OPENED_NO_REPLY_THRESHOLD_MS - 1000).toISOString(),
      reply: { detectedAt: new Date(NOW).toISOString() },
    });
    expect(getFollowUpSuggestion(message, NOW)).toBeNull();
  });

  it('never suggests a follow-up for a not_verifiable message — no reliable signal to act on', () => {
    const message = baseMessage({ status: 'not_verifiable', sentAt: new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString() });
    expect(getFollowUpSuggestion(message, NOW)).toBeNull();
  });
});
