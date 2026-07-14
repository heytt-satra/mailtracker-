import { describe, expect, it } from 'vitest';
import { buildMessageSummary, type MessageSummaryRow, type VerdictStats } from '../src/db/client';

function row(overrides: Partial<MessageSummaryRow> = {}): MessageSummaryRow {
  return {
    id: 'msg-1',
    subject: 'Hello',
    recipient: 'a@b.com',
    status: 'sent',
    sent_at: '2026-01-01T00:00:00.000Z',
    bounce_detected_at: null,
    bounce_reason: null,
    reply_detected_at: null,
    ...overrides,
  };
}

describe('buildMessageSummary', () => {
  it('fills in zeroed stats for a message with no verdict rows at all', () => {
    const summary = buildMessageSummary(row(), undefined);
    expect(summary.openCount).toBe(0);
    expect(summary.clickCount).toBe(0);
    expect(summary.readConfidence).toBeNull();
    expect(summary.bounce).toBeNull();
    expect(summary.reply).toBeNull();
  });

  it('passes through real verdict stats untouched when there is no reply', () => {
    const stats: VerdictStats = {
      openCount: 4,
      clickCount: 1,
      firstOpenedAt: '2026-01-01T00:05:00.000Z',
      lastOpenedAt: '2026-01-01T01:00:00.000Z',
      readConfidence: 'likely_read',
      minEngagedSeconds: null,
      readEvidence: 'Opened 4 times.',
      depthReached: null,
      sessionCount: 2,
      syncSuspect: false,
    };
    const summary = buildMessageSummary(row(), stats);
    expect(summary.openCount).toBe(4);
    expect(summary.readConfidence).toBe('likely_read');
    expect(summary.readEvidence).toBe('Opened 4 times.');
  });

  it('overrides read confidence to "read" and names the reply timestamp in the evidence when replied (ADR-21)', () => {
    const stats: VerdictStats = {
      openCount: 1,
      clickCount: 0,
      firstOpenedAt: '2026-01-01T00:05:00.000Z',
      lastOpenedAt: '2026-01-01T00:05:00.000Z',
      readConfidence: 'likely_read',
      minEngagedSeconds: null,
      readEvidence: 'Opened once.',
      depthReached: null,
      sessionCount: 1,
      syncSuspect: false,
    };
    const summary = buildMessageSummary(row({ reply_detected_at: '2026-01-02T00:00:00.000Z' }), stats);
    expect(summary.readConfidence).toBe('read');
    expect(summary.readEvidence).toContain('2026-01-02T00:00:00.000Z');
    expect(summary.reply).toEqual({ detectedAt: '2026-01-02T00:00:00.000Z' });
    // The underlying open count is untouched by the reply override — only the verdict/evidence are.
    expect(summary.openCount).toBe(1);
  });

  it('surfaces bounce info independently of read confidence (ADR-20)', () => {
    const summary = buildMessageSummary(row({ bounce_detected_at: '2026-01-01T02:00:00.000Z', bounce_reason: 'mailbox full' }), undefined);
    expect(summary.bounce).toEqual({ detectedAt: '2026-01-01T02:00:00.000Z', reason: 'mailbox full' });
  });
});
