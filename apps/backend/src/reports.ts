/**
 * Pure aggregation over a batch of messages into weekly/monthly report
 * stats. No DB/network — same discipline as read-signal.ts and
 * open-analysis.ts. Every number here is a real aggregate over data
 * already tracked (sentAt, readConfidence, openCount, clickCount,
 * firstOpenedAt) — nothing estimated or fabricated, consistent with the
 * product's core honesty principle.
 */

export interface ReportMessageInput {
  sentAt: string;
  recipient: string | null;
  readConfidence: 'read' | 'likely_read' | 'glanced' | 'not_verifiable' | null;
  openCount: number;
  clickCount: number;
  firstOpenedAt: string | null;
  bounced: boolean;
}

export interface TopRecipientStat {
  recipient: string;
  sentCount: number;
  openedCount: number;
}

export interface ReportStats {
  totalSent: number;
  verifiedOpenCount: number;
  clickCount: number;
  bounceCount: number;
  notVerifiableCount: number;
  /** Share of sent messages that reached 'read' or 'likely_read' — 0 when totalSent is 0, never divides by zero. */
  openRate: number;
  clickThroughRate: number;
  /** Average minutes from send to first verified open, across messages that have one. Null when no message in the batch has a verified open — an honest "no data" rather than a fabricated 0. */
  avgTimeToOpenMinutes: number | null;
  /** Count of sends by hour of day, UTC, index 0-23. */
  sendsByHourUtc: number[];
  /** Top 5 recipients by verified-open count (ties broken by send count), each with their own send/open counts. */
  topRecipients: TopRecipientStat[];
}

const TOP_RECIPIENTS_LIMIT = 5;

export function computeReportStats(messages: ReportMessageInput[]): ReportStats {
  const totalSent = messages.length;
  const verifiedOpenCount = messages.filter((m) => m.readConfidence === 'read' || m.readConfidence === 'likely_read').length;
  const clickCount = messages.filter((m) => m.clickCount > 0).length;
  const bounceCount = messages.filter((m) => m.bounced).length;
  const notVerifiableCount = messages.filter((m) => m.readConfidence === 'not_verifiable').length;

  const timeToOpenMinutes = messages
    .filter((m) => m.firstOpenedAt !== null)
    .map((m) => (new Date(m.firstOpenedAt!).getTime() - new Date(m.sentAt).getTime()) / 60_000)
    .filter((minutes) => minutes >= 0); // a corrupt/out-of-order timestamp shouldn't drag the average negative

  const sendsByHourUtc = new Array(24).fill(0);
  for (const m of messages) {
    sendsByHourUtc[new Date(m.sentAt).getUTCHours()]++;
  }

  const byRecipient = new Map<string, { sentCount: number; openedCount: number }>();
  for (const m of messages) {
    if (!m.recipient) continue;
    const entry = byRecipient.get(m.recipient) ?? { sentCount: 0, openedCount: 0 };
    entry.sentCount++;
    if (m.readConfidence === 'read' || m.readConfidence === 'likely_read') entry.openedCount++;
    byRecipient.set(m.recipient, entry);
  }
  const topRecipients: TopRecipientStat[] = [...byRecipient.entries()]
    .map(([recipient, stats]) => ({ recipient, ...stats }))
    .sort((a, b) => b.openedCount - a.openedCount || b.sentCount - a.sentCount)
    .slice(0, TOP_RECIPIENTS_LIMIT);

  return {
    totalSent,
    verifiedOpenCount,
    clickCount,
    bounceCount,
    notVerifiableCount,
    openRate: totalSent > 0 ? verifiedOpenCount / totalSent : 0,
    clickThroughRate: totalSent > 0 ? clickCount / totalSent : 0,
    avgTimeToOpenMinutes: timeToOpenMinutes.length > 0 ? timeToOpenMinutes.reduce((a, b) => a + b, 0) / timeToOpenMinutes.length : null,
    sendsByHourUtc,
    topRecipients,
  };
}

/** Null when the previous period had zero sends — a percent change against zero is undefined, not infinite or zero. */
export function computeVolumeChangePercent(currentTotal: number, previousTotal: number): number | null {
  if (previousTotal === 0) return null;
  return Math.round(((currentTotal - previousTotal) / previousTotal) * 100);
}
