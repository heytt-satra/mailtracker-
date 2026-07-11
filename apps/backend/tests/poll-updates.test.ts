import { describe, expect, it } from 'vitest';
import { buildPollUpdates } from '../src/poll-updates';

describe('buildPollUpdates', () => {
  it('returns nothing for no rows', () => {
    expect(buildPollUpdates([], [])).toEqual([]);
  });

  it('includes opened, clicked, and replied status changes (ADR-30 fix — replied was previously dropped)', () => {
    const rows = [
      { id: 'm1', status: 'opened', status_updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'm2', status: 'clicked', status_updated_at: '2026-01-01T00:01:00.000Z' },
      { id: 'm3', status: 'replied', status_updated_at: '2026-01-01T00:02:00.000Z' },
    ];
    const updates = buildPollUpdates(rows, []);
    expect(updates).toEqual([
      { msgId: 'm1', event: 'opened', occurredAt: '2026-01-01T00:00:00.000Z' },
      { msgId: 'm2', event: 'clicked', occurredAt: '2026-01-01T00:01:00.000Z' },
      { msgId: 'm3', event: 'replied', occurredAt: '2026-01-01T00:02:00.000Z' },
    ]);
  });

  it('ignores non-notification-worthy statuses (sent, delivered, not_verifiable)', () => {
    const rows = [
      { id: 'm1', status: 'sent', status_updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'm2', status: 'delivered', status_updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'm3', status: 'not_verifiable', status_updated_at: '2026-01-01T00:00:00.000Z' },
    ];
    expect(buildPollUpdates(rows, [])).toEqual([]);
  });

  it('includes bounces even though they are not a MessageStatus value (ADR-30 fix — bounces were previously dropped entirely)', () => {
    const bounceRows = [{ id: 'm4', bounce_detected_at: '2026-01-01T00:05:00.000Z' }];
    const updates = buildPollUpdates([], bounceRows);
    expect(updates).toEqual([{ msgId: 'm4', event: 'bounced', occurredAt: '2026-01-01T00:05:00.000Z' }]);
  });

  it('merges status and bounce updates for the same poll window', () => {
    const statusRows = [{ id: 'm1', status: 'opened', status_updated_at: '2026-01-01T00:00:00.000Z' }];
    const bounceRows = [{ id: 'm2', bounce_detected_at: '2026-01-01T00:01:00.000Z' }];
    const updates = buildPollUpdates(statusRows, bounceRows);
    expect(updates).toHaveLength(2);
    expect(updates.map((u) => u.event).sort()).toEqual(['bounced', 'opened']);
  });
});
