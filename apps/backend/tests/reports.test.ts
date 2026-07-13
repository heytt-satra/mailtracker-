import { describe, expect, it } from 'vitest';
import { computeReportStats, computeVolumeChangePercent, type ReportMessageInput } from '../src/reports';

function msg(overrides: Partial<ReportMessageInput> = {}): ReportMessageInput {
  return {
    sentAt: '2026-01-01T12:00:00.000Z',
    recipient: 'a@b.com',
    readConfidence: null,
    openCount: 0,
    clickCount: 0,
    firstOpenedAt: null,
    bounced: false,
    ...overrides,
  };
}

describe('computeReportStats', () => {
  it('returns zeroed stats for an empty batch, no division by zero', () => {
    const stats = computeReportStats([]);
    expect(stats.totalSent).toBe(0);
    expect(stats.openRate).toBe(0);
    expect(stats.clickThroughRate).toBe(0);
    expect(stats.avgTimeToOpenMinutes).toBeNull();
    expect(stats.topRecipients).toEqual([]);
  });

  it('counts verified opens (read + likely_read) but not not_verifiable or null', () => {
    const stats = computeReportStats([
      msg({ readConfidence: 'read' }),
      msg({ readConfidence: 'likely_read' }),
      msg({ readConfidence: 'not_verifiable' }),
      msg({ readConfidence: null }),
    ]);
    expect(stats.totalSent).toBe(4);
    expect(stats.verifiedOpenCount).toBe(2);
    expect(stats.notVerifiableCount).toBe(1);
    expect(stats.openRate).toBe(0.5);
  });

  it('computes click-through rate from clickCount > 0', () => {
    const stats = computeReportStats([msg({ clickCount: 1 }), msg({ clickCount: 0 }), msg({ clickCount: 2 })]);
    expect(stats.clickCount).toBe(2);
    expect(stats.clickThroughRate).toBeCloseTo(2 / 3);
  });

  it('counts bounces independently of read confidence', () => {
    const stats = computeReportStats([msg({ bounced: true }), msg({ bounced: false })]);
    expect(stats.bounceCount).toBe(1);
  });

  it('computes average time-to-open in minutes across messages that have a first open', () => {
    const stats = computeReportStats([
      msg({ sentAt: '2026-01-01T00:00:00.000Z', firstOpenedAt: '2026-01-01T00:10:00.000Z' }), // 10 min
      msg({ sentAt: '2026-01-01T00:00:00.000Z', firstOpenedAt: '2026-01-01T00:30:00.000Z' }), // 30 min
      msg({ sentAt: '2026-01-01T00:00:00.000Z', firstOpenedAt: null }), // excluded, no open
    ]);
    expect(stats.avgTimeToOpenMinutes).toBe(20);
  });

  it('never returns a negative time-to-open from a corrupt/out-of-order timestamp', () => {
    const stats = computeReportStats([msg({ sentAt: '2026-01-01T00:10:00.000Z', firstOpenedAt: '2026-01-01T00:00:00.000Z' })]);
    expect(stats.avgTimeToOpenMinutes).toBeNull();
  });

  it('buckets sends by UTC hour', () => {
    const stats = computeReportStats([
      msg({ sentAt: '2026-01-01T09:15:00.000Z' }),
      msg({ sentAt: '2026-01-01T09:45:00.000Z' }),
      msg({ sentAt: '2026-01-01T14:00:00.000Z' }),
    ]);
    expect(stats.sendsByHourUtc[9]).toBe(2);
    expect(stats.sendsByHourUtc[14]).toBe(1);
    expect(stats.sendsByHourUtc.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('ranks top recipients by opened count, tie-broken by sent count, capped at 5', () => {
    const messages: ReportMessageInput[] = [
      msg({ recipient: 'a@x.com', readConfidence: 'read' }),
      msg({ recipient: 'a@x.com', readConfidence: 'likely_read' }),
      msg({ recipient: 'b@x.com', readConfidence: 'read' }),
      msg({ recipient: 'c@x.com', readConfidence: null }),
      msg({ recipient: 'd@x.com', readConfidence: null }),
      msg({ recipient: 'e@x.com', readConfidence: null }),
      msg({ recipient: 'f@x.com', readConfidence: null }),
    ];
    const stats = computeReportStats(messages);
    expect(stats.topRecipients.length).toBe(5);
    expect(stats.topRecipients[0]).toEqual({ recipient: 'a@x.com', sentCount: 2, openedCount: 2 });
    expect(stats.topRecipients[1]).toEqual({ recipient: 'b@x.com', sentCount: 1, openedCount: 1 });
  });

  it('excludes messages with no recipient from the top-recipients ranking', () => {
    const stats = computeReportStats([msg({ recipient: null, readConfidence: 'read' })]);
    expect(stats.topRecipients).toEqual([]);
  });
});

describe('computeVolumeChangePercent', () => {
  it('computes a positive percent increase', () => {
    expect(computeVolumeChangePercent(15, 10)).toBe(50);
  });

  it('computes a negative percent decrease', () => {
    expect(computeVolumeChangePercent(5, 10)).toBe(-50);
  });

  it('returns null when the previous period had zero sends', () => {
    expect(computeVolumeChangePercent(10, 0)).toBeNull();
  });

  it('returns 0 when volume is unchanged', () => {
    expect(computeVolumeChangePercent(10, 10)).toBe(0);
  });
});
