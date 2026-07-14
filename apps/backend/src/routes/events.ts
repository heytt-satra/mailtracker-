import { Hono } from 'hono';
import { z } from 'zod';
import type { EventsPollResponse, MessageListResponse, MessageStatusResponse, TimelineEvent } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import {
  buildMessageSummary,
  deleteMessage,
  getMessageById,
  getMessageTimeline,
  getRecentVerifiedOpens,
  getSupabase,
  getVerdictStatsForMessages,
  getVerifiedOpenTimestamps,
  listMessagesForUser,
} from '../db/client';
import { isHotConversation, isRevival } from '../engagement-alerts';
import { apiKeyAuth } from '../middleware/auth';
import { buildPollUpdates } from '../poll-updates';
import { isoTimestamp, parseQuery } from '../lib/validate';

export const eventsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// Hono's /* wildcard requires a trailing segment, so it doesn't cover the
// bare list path — both patterns are needed to guard every /v1/messages
// route with auth.
eventsRoute.use('/v1/messages', apiKeyAuth);
eventsRoute.use('/v1/messages/*', apiKeyAuth);
// ADR-30: /v1/events/poll lives outside the /v1/messages prefix and was
// never covered by either line above — meaning apiKeyAuth never ran on it,
// c.get('userId') was always undefined, and the query below has been
// failing with "invalid input syntax for type uuid: undefined" since this
// endpoint was first built (ADR-7). This is the actual root cause of
// notifications never working; found by tailing live Worker logs against a
// real deployed request rather than guessing further.
eventsRoute.use('/v1/events/poll', apiKeyAuth);

/**
 * ADR-46: `offset` previously silently defaulted to 0 on ANY invalid value
 * (negative, non-numeric, whatever) — meaning a caller with a typo'd offset
 * would get page 1 back with no indication anything was wrong. Missing is
 * still a legitimate default (start from the top); present-but-invalid is
 * now a 400.
 */
export const listMessagesQuerySchema = z.object({ offset: z.coerce.number().int().nonnegative().optional() });

// Dashboard message list (M5). Paginated newest-first; `?offset=N` continues
// from a prior `nextOffset`.
eventsRoute.get('/v1/messages', async (c) => {
  const parsedQuery = parseQuery(c, listMessagesQuerySchema, { offset: c.req.query('offset') });
  if (!parsedQuery.ok) return parsedQuery.response;
  const offset = parsedQuery.data.offset ?? 0;

  const db = getSupabase(c.env);
  const { rows, nextOffset } = await listMessagesForUser(db, c.get('userId'), offset);
  const stats = await getVerdictStatsForMessages(db, rows.map((row) => row.id));
  const response: MessageListResponse = {
    messages: rows.map((row) => buildMessageSummary(row, stats.get(row.id))),
    nextOffset,
  };
  return c.json(response);
});

async function requireOwnedMessage(c: { env: Env; get: (k: 'userId') => string }, msgId: string) {
  const db = getSupabase(c.env);
  const message = await getMessageById(db, msgId);
  if (!message || message.user_id !== c.get('userId')) return null;
  return message;
}

eventsRoute.get('/v1/messages/:msgId/status', async (c) => {
  const message = await requireOwnedMessage(c, c.req.param('msgId'));
  if (!message) return c.json({ error: 'Not found' }, 404);
  const response: MessageStatusResponse = {
    msgId: message.id,
    status: message.status,
    statusUpdatedAt: message.status_updated_at,
  };
  return c.json(response);
});

eventsRoute.get('/v1/messages/:msgId/events', async (c) => {
  const message = await requireOwnedMessage(c, c.req.param('msgId'));
  if (!message) return c.json({ error: 'Not found' }, 404);

  const db = getSupabase(c.env);
  const timeline = await getMessageTimeline(db, message.id);
  const events: TimelineEvent[] = timeline.map((row) => ({
    occurredAt: row.occurred_at,
    kind: row.kind,
    verdict: row.verdict,
    reason: row.reason,
    suppressed: row.verdict === 'machine_suspect' || row.verdict === 'not_verifiable',
    clickedUrl: row.clicked_url,
  }));
  return c.json({ msgId: message.id, status: message.status, events });
});

eventsRoute.get('/v1/messages/:msgId/export', async (c) => {
  const message = await requireOwnedMessage(c, c.req.param('msgId'));
  if (!message) return c.json({ error: 'Not found' }, 404);

  const db = getSupabase(c.env);
  const timeline = await getMessageTimeline(db, message.id);
  const rows = ['occurred_at,kind,verdict,reason'];
  for (const row of timeline) {
    const reason = `"${row.reason.replace(/"/g, '""')}"`;
    rows.push([row.occurred_at, row.kind, row.verdict, reason].join(','));
  }
  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', `attachment; filename="mailtrack-${message.id}.csv"`);
  return c.body(rows.join('\n'));
});

eventsRoute.delete('/v1/messages/:msgId', async (c) => {
  const db = getSupabase(c.env);
  const deleted = await deleteMessage(db, c.req.param('msgId'), c.get('userId'));
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ deleted: true });
});

// ADR-7 (see PLAN.md): a true server-push SSE stream needs a Durable Object
// (or Supabase Realtime consumed directly by the extension) to hold a
// connection open on Cloudflare's request/response model. Building a
// half-working SSE endpoint here would violate "no half-finished
// implementations," so v1 ships a short-interval poll instead; the
// extension's background worker calls this every few seconds. Upgrading to
// real push is tracked in PLAN.md Future Improvements.
eventsRoute.get('/v1/events/poll', async (c) => {
  const parsedQuery = parseQuery(c, z.object({ since: isoTimestamp.optional() }), { since: c.req.query('since') });
  if (!parsedQuery.ok) return parsedQuery.response;
  const sinceDate = parsedQuery.data.since ? new Date(parsedQuery.data.since) : new Date(Date.now() - 60_000);

  const db = getSupabase(c.env);
  const userId = c.get('userId');

  // ADR-30: two independent queries, merged by the pure buildPollUpdates().
  // Bounces live in bounce_detected_at, a separate column (ADR-20 — bounce
  // is orthogonal to the status ladder, never a MessageStatus value), so a
  // single `status IN (...)` query can never catch them — that gap, plus
  // 'replied' being missing from the IN list, meant neither ever produced a
  // notification before this fix.
  const [statusResult, bounceResult] = await Promise.all([
    db
      .from('messages')
      .select('id, status, status_updated_at, recipient, subject')
      .eq('user_id', userId)
      .gt('status_updated_at', sinceDate.toISOString())
      .in('status', ['opened', 'clicked', 'replied']),
    db
      .from('messages')
      .select('id, bounce_detected_at, recipient, subject')
      .eq('user_id', userId)
      .gt('bounce_detected_at', sinceDate.toISOString()),
  ]);
  if (statusResult.error) {
    console.error('[events/poll] statusResult query failed:', statusResult.error);
    return c.json({ error: 'Query failed' }, 500);
  }
  if (bounceResult.error) {
    console.error('[events/poll] bounceResult query failed:', bounceResult.error);
    return c.json({ error: 'Query failed' }, 500);
  }

  const updates = buildPollUpdates(statusResult.data ?? [], bounceResult.data ?? []);

  // Hot Conversation / Revival alerts (see engagement-alerts.ts): unlike the
  // status-ladder events above, these can fire on ANY new verified open, not
  // just the first one that flips a message to 'opened' — so they need
  // their own query rather than reusing statusResult. Naturally fires at
  // most once per new open (a message only appears here again once it has
  // a genuinely new open since the last poll), so there's no need for
  // separate de-dup bookkeeping.
  try {
    const recentOpens = await getRecentVerifiedOpens(db, userId, sinceDate.toISOString());
    const seenMessageIds = new Set<string>();
    for (const open of recentOpens) {
      if (seenMessageIds.has(open.messageId)) continue;
      seenMessageIds.add(open.messageId);

      const allOpens = await getVerifiedOpenTimestamps(db, open.messageId);
      const latestOccurredAt = allOpens[allOpens.length - 1] ?? open.occurredAt;
      if (isHotConversation(allOpens)) {
        updates.push({ msgId: open.messageId, event: 'hot_conversation', occurredAt: latestOccurredAt, recipient: open.recipient, subject: open.subject });
      }
      if (isRevival(allOpens)) {
        updates.push({ msgId: open.messageId, event: 'revival', occurredAt: latestOccurredAt, recipient: open.recipient, subject: open.subject });
      }
    }
  } catch (err) {
    // Engagement alerts are a bonus signal on top of the core poll response
    // — a failure here must never break opened/clicked/replied/bounced
    // notifications, which have already been computed above.
    console.error('[events/poll] engagement-alert detection failed:', err);
  }

  const response: EventsPollResponse = {
    polledAt: new Date().toISOString(),
    updates,
  };
  return c.json(response);
});
