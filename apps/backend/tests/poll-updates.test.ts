import { describe, expect, it } from 'vitest';
import { buildPollUpdates } from '../src/poll-updates';

describe('buildPollUpdates', () => {
  it('returns nothing for no rows', () => {
    expect(buildPollUpdates([], [])).toEqual([]);
  });

  it('includes opened, clicked, and replied status changes (ADR-30 fix — replied was previously dropped)', () => {
    const rows = [
      { id: 'm1', status: 'opened', status_updated_at: '2026-01-01T00:00:00.000Z', recipient: 'a@x.com', subject: 'Hi' },
      { id: 'm2', status: 'clicked', status_updated_at: '2026-01-01T00:01:00.000Z', recipient: 'b@x.com', subject: 'Yo' },
      { id: 'm3', status: 'replied', status_updated_at: '2026-01-01T00:02:00.000Z', recipient: 'c@x.com', subject: null },
    ];
    const updates = buildPollUpdates(rows, []);
    expect(updates).toEqual([
      { msgId: 'm1', event: 'opened', occurredAt: '2026-01-01T00:00:00.000Z', recipient: 'a@x.com', subject: 'Hi' },
      { msgId: 'm2', event: 'clicked', occurredAt: '2026-01-01T00:01:00.000Z', recipient: 'b@x.com', subject: 'Yo' },
      { msgId: 'm3', event: 'replied', occurredAt: '2026-01-01T00:02:00.000Z', recipient: 'c@x.com', subject: null },
    ]);
  });

  it('ignores non-notification-worthy statuses (sent, delivered, not_verifiable)', () => {
    const rows = [
      { id: 'm1', status: 'sent', status_updated_at: '2026-01-01T00:00:00.000Z', recipient: null, subject: null },
      { id: 'm2', status: 'delivered', status_updated_at: '2026-01-01T00:00:00.000Z', recipient: null, subject: null },
      { id: 'm3', status: 'not_verifiable', status_updated_at: '2026-01-01T00:00:00.000Z', recipient: null, subject: null },
    ];
    expect(buildPollUpdates(rows, [])).toEqual([]);
  });

  it('includes bounces even though they are not a MessageStatus value (ADR-30 fix — bounces were previously dropped entirely)', () => {
    const bounceRows = [{ id: 'm4', bounce_detected_at: '2026-01-01T00:05:00.000Z', recipient: 'd@x.com', subject: 'Bounced one' }];
    const updates = buildPollUpdates([], bounceRows);
    expect(updates).toEqual([{ msgId: 'm4', event: 'bounced', occurredAt: '2026-01-01T00:05:00.000Z', recipient: 'd@x.com', subject: 'Bounced one' }]);
  });

  it('merges status and bounce updates for the same poll window', () => {
    const statusRows = [{ id: 'm1', status: 'opened', status_updated_at: '2026-01-01T00:00:00.000Z', recipient: 'a@x.com', subject: null }];
    const bounceRows = [{ id: 'm2', bounce_detected_at: '2026-01-01T00:01:00.000Z', recipient: 'b@x.com', subject: null }];
    const updates = buildPollUpdates(statusRows, bounceRows);
    expect(updates).toHaveLength(2);
    expect(updates.map((u) => u.event).sort()).toEqual(['bounced', 'opened']);
  });

  it('carries recipient and subject through so the extension can build a specific notification (recipient/subject fix)', () => {
    const rows = [{ id: 'm1', status: 'opened', status_updated_at: '2026-01-01T00:00:00.000Z', recipient: 'jane@example.com', subject: 'Q3 proposal' }];
    const updates = buildPollUpdates(rows, []);
    expect(updates[0]?.recipient).toBe('jane@example.com');
    expect(updates[0]?.subject).toBe('Q3 proposal');
  });
});
