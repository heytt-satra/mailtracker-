import { describe, expect, it } from 'vitest';
import { buildReportPdf, reportPdfFilename } from '../src/report-pdf';
import type { ReportsResponse } from '@mailtrack/shared';

function makePeriodStats(overrides: Partial<ReportsResponse['current']> = {}): ReportsResponse['current'] {
  return {
    totalSent: 10,
    verifiedOpenCount: 6,
    clickCount: 2,
    bounceCount: 1,
    notVerifiableCount: 3,
    repliedCount: 1,
    totalOpens: 14,
    totalClicks: 3,
    openRate: 0.6,
    clickThroughRate: 0.2,
    replyRate: 0.1,
    bounceRate: 0.1,
    avgTimeToOpenMinutes: 42,
    medianTimeToOpenMinutes: 30,
    sendsByHourUtc: new Array(24).fill(0).map((_, i) => (i === 9 ? 5 : 0)),
    sendsByDayOfWeekUtc: [1, 2, 0, 3, 0, 4, 0],
    readConfidenceBreakdown: { read: 3, likelyRead: 3, glanced: 0, notVerifiable: 3, pending: 1 },
    topRecipients: [
      { recipient: 'a@b.com', sentCount: 3, openedCount: 2, openRate: 2 / 3, totalOpenCount: 5, totalClickCount: 1 },
      { recipient: 'c@d.com', sentCount: 1, openedCount: 0, openRate: 0, totalOpenCount: 0, totalClickCount: 0 },
    ],
    messages: [
      {
        msgId: 'msg-1',
        subject: 'Hello',
        recipient: 'a@b.com',
        status: 'opened',
        sentAt: '2026-01-02T09:00:00.000Z',
        openCount: 4,
        clickCount: 1,
        firstOpenedAt: '2026-01-02T09:05:00.000Z',
        lastOpenedAt: '2026-01-02T10:00:00.000Z',
        readConfidence: 'likely_read',
        minEngagedSeconds: null,
        readEvidence: 'Opened 4 times.',
        depthReached: null,
        sessionCount: 2,
        syncSuspect: false,
        bounce: null,
        reply: null,
      },
    ],
    ...overrides,
  };
}

function makeReport(overrides: Partial<ReportsResponse> = {}): ReportsResponse {
  const current = makePeriodStats();
  return {
    period: 'week',
    rangeStart: '2026-01-01T00:00:00.000Z',
    rangeEnd: '2026-01-08T00:00:00.000Z',
    current,
    previous: makePeriodStats({ totalSent: 8 }),
    volumeChangePercent: 25,
    ...overrides,
  };
}

describe('buildReportPdf', () => {
  it('produces a non-empty PDF document without throwing', () => {
    const doc = buildReportPdf(makeReport(), '2026-01-08T12:00:00.000Z');
    const output = doc.output('datauristring');
    expect(output.startsWith('data:application/pdf')).toBe(true);
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it('handles an empty-period report (zero sends) without throwing', () => {
    const empty = makeReport({
      current: makePeriodStats({
        totalSent: 0,
        verifiedOpenCount: 0,
        clickCount: 0,
        bounceCount: 0,
        notVerifiableCount: 0,
        repliedCount: 0,
        totalOpens: 0,
        totalClicks: 0,
        openRate: 0,
        clickThroughRate: 0,
        replyRate: 0,
        bounceRate: 0,
        avgTimeToOpenMinutes: null,
        medianTimeToOpenMinutes: null,
        sendsByHourUtc: new Array(24).fill(0),
        sendsByDayOfWeekUtc: new Array(7).fill(0),
        readConfidenceBreakdown: { read: 0, likelyRead: 0, glanced: 0, notVerifiable: 0, pending: 0 },
        topRecipients: [],
        messages: [],
      }),
      volumeChangePercent: null,
    });
    expect(() => buildReportPdf(empty, '2026-01-08T12:00:00.000Z')).not.toThrow();
  });
});

describe('reportPdfFilename', () => {
  it('builds a filename from period and range-end date', () => {
    expect(reportPdfFilename('week', '2026-01-08T12:34:56.000Z')).toBe('mailtrack-report-week-2026-01-08.pdf');
    expect(reportPdfFilename('month', '2026-02-01T00:00:00.000Z')).toBe('mailtrack-report-month-2026-02-01.pdf');
  });
});
