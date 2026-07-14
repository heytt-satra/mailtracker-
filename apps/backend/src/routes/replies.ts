import { Hono } from 'hono';
import { z } from 'zod';
import type { ReportReplyResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { getMessageById, getSupabase, markMessageReplied } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { checkRateLimit, ONE_MINUTE_MS, rateLimitedResponse, readRateLimitInt } from '../lib/rate-limit';
import { isoTimestamp, parseJsonBody } from '../lib/validate';

export const repliesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

export const reportReplySchema = z.object({ msgId: z.string().min(1).max(100), detectedAt: isoTimestamp }).strict();

/**
 * ADR-21: records that the recipient replied in a tracked thread. Unlike
 * bounce correlation (ADR-20), there is no fuzzy matching here — the
 * extension already knows the exact msgId from its own threadId->msgId map
 * (stored at send time), so this just validates ownership and escalates.
 * Authenticated; ownership is checked so one user can't mark another's
 * message replied.
 */
repliesRoute.post('/v1/replies', apiKeyAuth, async (c) => {
  // ADR-45: same shared "writes" bucket as POST /v1/messages and /v1/bounces.
  const writeLimit = readRateLimitInt(c.env.RATE_LIMIT_WRITES_PER_MIN, 30);
  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `writes:${c.get('userId')}`, { limit: writeLimit, windowMs: ONE_MINUTE_MS, backoff: false });
  if (!allowed) return rateLimitedResponse(c, retryAfterSeconds);

  const parsed = await parseJsonBody(c, reportReplySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const detectedAt = new Date(body.detectedAt);

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
