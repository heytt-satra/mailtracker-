import { Hono } from 'hono';
import { z } from 'zod';
import type { ReportBounceResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { getBounceCandidateMessages, getSupabase, markMessageBounced } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { correlateBounce, MAX_BOUNCE_DELAY_MS } from '../bounce-correlation';
import { checkRateLimit, ONE_MINUTE_MS, rateLimitedResponse, readRateLimitInt } from '../lib/rate-limit';
import { isoTimestamp, parseJsonBody } from '../lib/validate';

export const bouncesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_SUBJECT_EXCERPT_LENGTH = 200;
const MAX_DIAGNOSTIC_LENGTH = 500;

/**
 * ADR-46 strict input validation: recipientEmail previously had NO
 * format check at all (just a length truncation) — now rejected outright
 * if it isn't a real email address, and rejected (not truncated) if it
 * exceeds the RFC 5321 practical max of 320 chars.
 */
export const reportBounceSchema = z
  .object({
    recipientEmail: z.string().trim().email().max(320),
    bounceReceivedAt: isoTimestamp,
    subjectExcerpt: z.string().trim().max(MAX_SUBJECT_EXCERPT_LENGTH).optional(),
    diagnostic: z.string().trim().max(MAX_DIAGNOSTIC_LENGTH).optional(),
  })
  .strict();

/**
 * ADR-20: reports a bounce notification the extension detected in the
 * sender's own inbox (see apps/extension/src/bounce-detection.ts) and
 * correlates it to a tracked message. Authenticated, same as every other
 * write endpoint — unlike /p/ and /l/, there is no anonymous-fetch shape
 * here to fail open around, so this can validate strictly.
 */
bouncesRoute.post('/v1/bounces', apiKeyAuth, async (c) => {
  // ADR-45: same shared "writes" bucket as POST /v1/messages and /v1/replies.
  const writeLimit = readRateLimitInt(c.env.RATE_LIMIT_WRITES_PER_MIN, 30);
  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `writes:${c.get('userId')}`, { limit: writeLimit, windowMs: ONE_MINUTE_MS, backoff: false });
  if (!allowed) return rateLimitedResponse(c, retryAfterSeconds);

  const parsed = await parseJsonBody(c, reportBounceSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const bounceReceivedAt = new Date(body.bounceReceivedAt);

  const db = getSupabase(c.env);
  const userId = c.get('userId');

  const sinceIso = new Date(bounceReceivedAt.getTime() - MAX_BOUNCE_DELAY_MS).toISOString();
  const candidates = await getBounceCandidateMessages(db, userId, sinceIso);

  const result = correlateBounce(candidates, {
    recipientEmail: body.recipientEmail,
    subjectExcerpt: body.subjectExcerpt || undefined,
    bounceReceivedAt: bounceReceivedAt.toISOString(),
  });

  if (result.matchedMsgId) {
    const diagnostic = body.diagnostic || null;
    const reason = diagnostic ? `${result.reason} Diagnostic: "${diagnostic}"` : result.reason;
    await markMessageBounced(db, result.matchedMsgId, { detectedAt: bounceReceivedAt.toISOString(), reason });
  }

  const response: ReportBounceResponse = { matchedMsgId: result.matchedMsgId, reason: result.reason };
  return c.json(response, 200);
});
