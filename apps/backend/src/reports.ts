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
  replied: boolean;
}

export interface TopRecipientStat {
  recipient: string;
  sentCount: number;
  openedCount: number;
  /** openedCount / sentCount — always defined since sentCount is never 0 for a recipient entry. */
  openRate: number;
}

/**
 * How every sent message's read-confidence classified out, including the
 * ones with no verdict at all yet (`pending`) — distinct from
 * `not_verifiable` (a verdict was reached, but the evidence doesn't clear
 * the bar for a read). Counts sum to `totalSent`.
 */
export interface ReadConfidenceBreakdown {
  read: number;
  likelyRead: number;
  glanced: number;
  notVerifiable: number;
  pending: number;
}

export interface ReportStats {
  totalSent: number;
  verifiedOpenCount: number;
  clickCount: number;
  bounceCount: number;
  notVerifiableCount: number;
  repliedCount: number;
  /** Sum of per-message open counts — engagement depth, distinct from verifiedOpenCount (a count of messages, not of opens). */
  totalOpens: number;
  /** Sum of per-message click counts. */
  totalClicks: number;
  /** Share of sent messages that reached 'read' or 'likely_read' — 0 when totalSent is 0, never divides by zero. */
  openRate: number;
  clickThroughRate: number;
  replyRate: number;
  bounceRate: number;
  /** Average minutes from send to first verified open, across messages that have one. Null when no message in the batch has a verified open — an honest "no data" rather than a fabricated 0. */
  avgTimeToOpenMinutes: number | null;
  /** Median minutes from send to first verified open — less skewed by a handful of very slow opens than the average. Same null-when-no-data rule. */
  medianTimeToOpenMinutes: number | null;
  /** Count of sends by hour of day, UTC, index 0-23. */
  sendsByHourUtc: number[];
  /** Count of sends by day of week, UTC, index 0 (Sunday) - 6 (Saturday), matching Date#getUTCDay(). */
  sendsByDayOfWeekUtc: number[];
  readConfidenceBreakdown: ReadConfidenceBreakdown;
  /** Recipients by verified-open count (ties broken by send count), each with their own send/open counts. Capped at TOP_RECIPIENTS_LIMIT — a report is a trend view, not an exhaustive export. */
  topRecipients: TopRecipientStat[];
}

const TOP_RECIPIENTS_LIMIT = 20;

function median(sortedAscending: number[]): number | null {
  if (sortedAscending.length === 0) return null;
  const mid = Math.floor(sortedAscending.length / 2);
  return sortedAscending.length % 2 === 0 ? (sortedAscending[mid - 1]! + sortedAscending[mid]!) / 2 : sortedAscending[mid]!;
}

export function computeReportStats(messages: ReportMessageInput[]): ReportStats {
  const totalSent = messages.length;
  const verifiedOpenCount = messages.filter((m) => m.readConfidence === 'read' || m.readConfidence === 'likely_read').length;
  const clickCount = messages.filter((m) => m.clickCount > 0).length;
  const bounceCount = messages.filter((m) => m.bounced).length;
  const notVerifiableCount = messages.filter((m) => m.readConfidence === 'not_verifiable').length;
  const repliedCount = messages.filter((m) => m.replied).length;
  const totalOpens = messages.reduce((sum, m) => sum + m.openCount, 0);
  const totalClicks = messages.reduce((sum, m) => sum + m.clickCount, 0);

  const readConfidenceBreakdown: ReadConfidenceBreakdown = {
    read: messages.filter((m) => m.readConfidence === 'read').length,
    likelyRead: messages.filter((m) => m.readConfidence === 'likely_read').length,
    glanced: messages.filter((m) => m.readConfidence === 'glanced').length,
    notVerifiable: notVerifiableCount,
    pending: messages.filter((m) => m.readConfidence === null).length,
  };

  const timeToOpenMinutes = messages
    .filter((m) => m.firstOpenedAt !== null)
    .map((m) => (new Date(m.firstOpenedAt!).getTime() - new Date(m.sentAt).getTime()) / 60_000)
    .filter((minutes) => minutes >= 0) // a corrupt/out-of-order timestamp shouldn't drag the average negative
    .sort((a, b) => a - b);

  const sendsByHourUtc = new Array(24).fill(0);
  const sendsByDayOfWeekUtc = new Array(7).fill(0);
  for (const m of messages) {
    const sentDate = new Date(m.sentAt);
    sendsByHourUtc[sentDate.getUTCHours()]++;
    sendsByDayOfWeekUtc[sentDate.getUTCDay()]++;
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
    .map(([recipient, stats]) => ({ recipient, ...stats, openRate: stats.openedCount / stats.sentCount }))
    .sort((a, b) => b.openedCount - a.openedCount || b.sentCount - a.sentCount)
    .slice(0, TOP_RECIPIENTS_LIMIT);

  return {
    totalSent,
    verifiedOpenCount,
    clickCount,
    bounceCount,
    notVerifiableCount,
    repliedCount,
    totalOpens,
    totalClicks,
    openRate: totalSent > 0 ? verifiedOpenCount / totalSent : 0,
    clickThroughRate: totalSent > 0 ? clickCount / totalSent : 0,
    replyRate: totalSent > 0 ? repliedCount / totalSent : 0,
    bounceRate: totalSent > 0 ? bounceCount / totalSent : 0,
    avgTimeToOpenMinutes: timeToOpenMinutes.length > 0 ? timeToOpenMinutes.reduce((a, b) => a + b, 0) / timeToOpenMinutes.length : null,
    medianTimeToOpenMinutes: median(timeToOpenMinutes),
    sendsByHourUtc,
    sendsByDayOfWeekUtc,
    readConfidenceBreakdown,
    topRecipients,
  };
}

/** Null when the previous period had zero sends — a percent change against zero is undefined, not infinite or zero. */
export function computeVolumeChangePercent(currentTotal: number, previousTotal: number): number | null {
  if (previousTotal === 0) return null;
  return Math.round(((currentTotal - previousTotal) / previousTotal) * 100);
}
