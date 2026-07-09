import { Hono } from 'hono';
import type { ReportBounceRequest, ReportBounceResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { getBounceCandidateMessages, getSupabase, markMessageBounced } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { correlateBounce, MAX_BOUNCE_DELAY_MS } from '../bounce-correlation';

export const bouncesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_SUBJECT_EXCERPT_LENGTH = 200;
const MAX_DIAGNOSTIC_LENGTH = 500;

/**
 * ADR-20: reports a bounce notification the extension detected in the
 * sender's own inbox (see apps/extension/src/bounce-detection.ts) and
 * correlates it to a tracked message. Authenticated, same as every other
 * write endpoint — unlike /p/ and /l/, there is no anonymous-fetch shape
 * here to fail open around, so this can validate strictly.
 */
bouncesRoute.post('/v1/bounces', apiKeyAuth, async (c) => {
  const { success } = await c.env.MESSAGES_RATE_LIMITER.limit({ key: c.get('userId') });
  if (!success) return c.json({ error: 'Rate limit exceeded' }, 429);

  const body = await c.req.json<ReportBounceRequest>().catch(() => null);
  if (!body || typeof body.recipientEmail !== 'string' || typeof body.bounceReceivedAt !== 'string') {
    return c.json({ error: 'Body must include recipientEmail and bounceReceivedAt' }, 400);
  }
  const bounceReceivedAt = new Date(body.bounceReceivedAt);
  if (Number.isNaN(bounceReceivedAt.getTime())) {
    return c.json({ error: 'bounceReceivedAt must be a valid ISO-8601 timestamp' }, 400);
  }

  const db = getSupabase(c.env);
  const userId = c.get('userId');

  const sinceIso = new Date(bounceReceivedAt.getTime() - MAX_BOUNCE_DELAY_MS).toISOString();
  const candidates = await getBounceCandidateMessages(db, userId, sinceIso);

  const result = correlateBounce(candidates, {
    recipientEmail: body.recipientEmail.trim().slice(0, 320),
    subjectExcerpt: typeof body.subjectExcerpt === 'string' ? body.subjectExcerpt.trim().slice(0, MAX_SUBJECT_EXCERPT_LENGTH) || undefined : undefined,
    bounceReceivedAt: bounceReceivedAt.toISOString(),
  });

  if (result.matchedMsgId) {
    const diagnostic = typeof body.diagnostic === 'string' ? body.diagnostic.trim().slice(0, MAX_DIAGNOSTIC_LENGTH) : null;
    const reason = diagnostic ? `${result.reason} Diagnostic: "${diagnostic}"` : result.reason;
    await markMessageBounced(db, result.matchedMsgId, { detectedAt: bounceReceivedAt.toISOString(), reason });
  }

  const response: ReportBounceResponse = { matchedMsgId: result.matchedMsgId, reason: result.reason };
  return c.json(response, 200);
});
