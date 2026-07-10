import { Hono } from 'hono';
import type { ReportReplyRequest, ReportReplyResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { getMessageById, getSupabase, markMessageReplied } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';

export const repliesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * ADR-21: records that the recipient replied in a tracked thread. Unlike
 * bounce correlation (ADR-20), there is no fuzzy matching here — the
 * extension already knows the exact msgId from its own threadId->msgId map
 * (stored at send time), so this just validates ownership and escalates.
 * Authenticated; ownership is checked so one user can't mark another's
 * message replied.
 */
repliesRoute.post('/v1/replies', apiKeyAuth, async (c) => {
  const { success } = await c.env.MESSAGES_RATE_LIMITER.limit({ key: c.get('userId') });
  if (!success) return c.json({ error: 'Rate limit exceeded' }, 429);

  const body = await c.req.json<ReportReplyRequest>().catch(() => null);
  if (!body || typeof body.msgId !== 'string' || typeof body.detectedAt !== 'string') {
    return c.json({ error: 'Body must include msgId and detectedAt' }, 400);
  }
  const detectedAt = new Date(body.detectedAt);
  if (Number.isNaN(detectedAt.getTime())) {
    return c.json({ error: 'detectedAt must be a valid ISO-8601 timestamp' }, 400);
  }

  const db = getSupabase(c.env);
  const message = await getMessageById(db, body.msgId);
  if (!message || message.user_id !== c.get('userId')) {
    // Same opaque 404 as every other ownership check — never confirm a msgId exists for another account.
    return c.json({ error: 'Not found' }, 404);
  }

  await markMessageReplied(db, message.id, { detectedAt: detectedAt.toISOString() });

  const response: ReportReplyResponse = { ok: true };
  return c.json(response, 200);
});
