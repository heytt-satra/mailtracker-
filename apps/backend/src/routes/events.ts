import { Hono } from 'hono';
import type { EventsPollResponse, MessageListResponse, MessageStatusResponse, TimelineEvent } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { deleteMessage, getMessageById, getMessageTimeline, getSupabase, getVerdictStatsForMessages, listMessagesForUser } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { buildPollUpdates } from '../poll-updates';

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

// Dashboard message list (M5). Paginated newest-first; `?offset=N` continues
// from a prior `nextOffset`.
eventsRoute.get('/v1/messages', async (c) => {
  const offset = Number(c.req.query('offset') ?? '0');
  const db = getSupabase(c.env);
  const { rows, nextOffset } = await listMessagesForUser(db, c.get('userId'), Number.isFinite(offset) && offset >= 0 ? offset : 0);
  const stats = await getVerdictStatsForMessages(db, rows.map((row) => row.id));
  const response: MessageListResponse = {
    messages: rows.map((row) => {
      const rowStats = stats.get(row.id) ?? {
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
      };
      const bounce = row.bounce_detected_at ? { detectedAt: row.bounce_detected_at, reason: row.bounce_reason ?? '' } : null;
      const reply = row.reply_detected_at ? { detectedAt: row.reply_detected_at } : null;
      // ADR-21: a reply is definitive proof of reading, so it overrides the
      // pixel/click-derived read confidence with the strongest possible
      // verdict and evidence — no sync/proxy ambiguity can produce a reply.
      const withReply = reply
        ? {
            ...rowStats,
            readConfidence: 'read' as const,
            readEvidence: `Replied to your email — definitive proof they read it (${reply.detectedAt}).`,
          }
        : rowStats;
      return { msgId: row.id, subject: row.subject, recipient: row.recipient, status: row.status, sentAt: row.sent_at, ...withReply, bounce, reply };
    }),
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
  const since = c.req.query('since');
  const sinceDate = since ? new Date(since) : new Date(Date.now() - 60_000);
  if (Number.isNaN(sinceDate.getTime())) {
    return c.json({ error: 'since must be an ISO-8601 timestamp' }, 400);
  }

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
      .select('id, status, status_updated_at')
      .eq('user_id', userId)
      .gt('status_updated_at', sinceDate.toISOString())
      .in('status', ['opened', 'clicked', 'replied']),
    db.from('messages').select('id, bounce_detected_at').eq('user_id', userId).gt('bounce_detected_at', sinceDate.toISOString()),
  ]);
  if (statusResult.error) {
    console.error('[events/poll] statusResult query failed:', statusResult.error);
    return c.json({ error: 'Query failed' }, 500);
  }
  if (bounceResult.error) {
    console.error('[events/poll] bounceResult query failed:', bounceResult.error);
    return c.json({ error: 'Query failed' }, 500);
  }

  const response: EventsPollResponse = {
    polledAt: new Date().toISOString(),
    updates: buildPollUpdates(statusResult.data ?? [], bounceResult.data ?? []),
  };
  return c.json(response);
});
