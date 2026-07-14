import { Hono } from 'hono';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReportPeriodStats, ReportsResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { buildMessageSummary, getMessagesForReport, getSupabase, getVerdictStatsForMessages, type MessageSummaryRow } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { computeReportStats, computeVolumeChangePercent, type ReportMessageInput } from '../reports';
import { parseQuery } from '../lib/validate';

export const reportsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// ADR-46: `period` previously silently fell back to 'week' for ANY value
// other than the literal string 'month' — a typo'd query param would just
// silently return the wrong report instead of erroring.
export const reportsQuerySchema = z.object({ period: z.enum(['week', 'month']).optional() });

reportsRoute.get('/v1/reports', apiKeyAuth, async (c) => {
  const parsedQuery = parseQuery(c, reportsQuerySchema, { period: c.req.query('period') });
  if (!parsedQuery.ok) return parsedQuery.response;
  const period = parsedQuery.data.period ?? 'week';
  const periodMs = period === 'month' ? MONTH_MS : WEEK_MS;

  const nowMs = Date.now();
  const rangeEnd = new Date(nowMs).toISOString();
  const rangeStart = new Date(nowMs - periodMs).toISOString();
  const previousStart = new Date(nowMs - 2 * periodMs).toISOString();

  const db = getSupabase(c.env);
  const userId = c.get('userId');

  const [currentRows, previousRows] = await Promise.all([
    getMessagesForReport(db, userId, rangeStart, rangeEnd),
    getMessagesForReport(db, userId, previousStart, rangeStart),
  ]);
  const [current, previous] = await Promise.all([
    buildReportPeriodStats(db, currentRows, { includeMessages: true }),
    buildReportPeriodStats(db, previousRows, { includeMessages: false }),
  ]);

  const response: ReportsResponse = {
    period,
    rangeStart,
    rangeEnd,
    current,
    previous,
    volumeChangePercent: computeVolumeChangePercent(current.totalSent, previous.totalSent),
  };
  return c.json(response);
});

async function buildReportPeriodStats(db: SupabaseClient, rows: MessageSummaryRow[], opts: { includeMessages: boolean }): Promise<ReportPeriodStats> {
  const verdictStats = await getVerdictStatsForMessages(
    db,
    rows.map((r) => r.id),
  );
  const inputs: ReportMessageInput[] = rows.map((row) => {
    const stats = verdictStats.get(row.id);
    return {
      sentAt: row.sent_at,
      recipient: row.recipient,
      readConfidence: stats?.readConfidence ?? null,
      openCount: stats?.openCount ?? 0,
      clickCount: stats?.clickCount ?? 0,
      firstOpenedAt: stats?.firstOpenedAt ?? null,
      bounced: row.bounce_detected_at !== null,
      replied: row.reply_detected_at !== null,
    };
  });
  const aggregate = computeReportStats(inputs);
  // `previous` only ever backs the volume-change comparison — the dashboard
  // has no use for its per-message detail, so skip building it there to
  // avoid doubling the response's payload size for data nothing reads.
  const messages = opts.includeMessages ? rows.map((row) => buildMessageSummary(row, verdictStats.get(row.id))) : [];
  return { ...aggregate, messages };
}
