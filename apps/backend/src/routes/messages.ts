import { Hono } from 'hono';
import { z } from 'zod';
import type { CreateMessageResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { getSupabase, hasActiveSubscription, insertBeaconTokens, insertLinkTokens, insertMessage } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { randomToken } from '../lib/crypto';
import { checkRateLimit, ONE_MINUTE_MS, rateLimitedResponse, readRateLimitInt } from '../lib/rate-limit';
import { parseJsonBody } from '../lib/validate';

export const messagesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * ADR-19: only messages whose composed HTML body is already this long get
 * depth beacons at all. Gmail's well-documented "message clipped" behavior
 * truncates the rendered DOM at roughly 102KB of the assembled message
 * (quoted history included, which the extension's bodyLength measurement
 * doesn't see) — staying comfortably under that with this gate means a
 * message this long is very likely to actually clip, so the resulting
 * depthReached signal means what it claims. For the common case (a normal,
 * much-shorter email), no beacons are generated at all: injecting them
 * would just be redundant noise indistinguishable from the ordinary
 * top-pixel open, plus unnecessary deliverability/load-time cost for zero
 * new information (see docs/read-detection-plan.md §8 risks).
 */
const LONG_MESSAGE_BEACON_THRESHOLD_BYTES = 90_000;

// A real email body doesn't have hundreds of distinct links; this is a
// sanity cap against a malformed/malicious client turning one send into an
// unbounded batch insert, not a business rule.
const MAX_LINK_URLS = 50;

// Gmail itself doesn't hard-cap subject length, but nothing needs more than
// this for a dashboard list row.
const MAX_SUBJECT_LENGTH = 500;
const MAX_RECIPIENT_LENGTH = 500;

/**
 * Strict schema: a body that doesn't match is rejected (400) outright, not
 * silently truncated or defaulted — the previous version truncated an
 * overlong subject/recipient to fit rather than rejecting it. `.strict()`
 * also rejects unexpected extra fields, not just wrong-shaped known ones.
 * `linkUrls` entries are validated as syntactically well-formed URLs here
 * (a non-URL string is a malformed request); `isTrackableUrl()` below is a
 * SEPARATE, deliberate filter for scheme (http/https only) — kept as a
 * filter rather than a rejection because a single non-http(s) link (e.g. a
 * `mailto:` in a signature) shouldn't fail the whole send (NFR2 fail-open).
 */
export const createMessageSchema = z
  .object({
    linkUrls: z.array(z.string().url()).max(MAX_LINK_URLS),
    gmailMessageId: z.string().max(200).optional(),
    subject: z.string().trim().max(MAX_SUBJECT_LENGTH).optional(),
    recipient: z.string().trim().max(MAX_RECIPIENT_LENGTH).optional(),
    bodyLength: z.number().int().nonnegative().optional(),
  })
  .strict();

messagesRoute.post('/v1/messages', apiKeyAuth, async (c) => {
  const userId = c.get('userId');

  // Bounds the blast radius of a leaked/compromised API key — 30 tracked
  // sends/minute (configurable via RATE_LIMIT_WRITES_PER_MIN) is generous
  // for a human composing email, well below what a spam/abuse script would
  // want to do with a stolen key. Shared "writes" bucket with bounces.ts/
  // replies.ts (ADR-45) — same reasoning as before the DO-based rewrite.
  const writeLimit = readRateLimitInt(c.env.RATE_LIMIT_WRITES_PER_MIN, 30);
  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `writes:${userId}`, { limit: writeLimit, windowMs: ONE_MINUTE_MS, backoff: false });
  if (!allowed) return rateLimitedResponse(c, retryAfterSeconds);

  // ADR-36: subscription gate. Only NEW tracking is blocked — a lapsed
  // subscription never touches already-tracked messages or dashboard
  // history, both of which read straight through this route.
  const db = getSupabase(c.env);
  if (!(await hasActiveSubscription(db, userId))) {
    return c.json({ error: 'An active MailTrack subscription is required to track new emails.' }, 402);
  }

  const parsed = await parseJsonBody(c, createMessageSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // Scheme filter, not a rejection — see createMessageSchema's doc comment.
  const validLinkUrls = body.linkUrls.filter(isTrackableUrl);
  const subject = body.subject || undefined; // an all-whitespace subject trims to '' — treat the same as omitted, not an error
  const recipient = body.recipient || undefined;

  const pixelToken = randomToken();

  const message = await insertMessage(db, { userId, gmailMessageId: body.gmailMessageId, subject, recipient, pixelToken });

  const linkTokens = validLinkUrls.map((originalUrl) => ({ token: randomToken(), originalUrl }));
  await insertLinkTokens(db, message.id, linkTokens);

  const origin = new URL(c.req.url).origin;
  const response: CreateMessageResponse = {
    msgId: message.id,
    pixelUrl: `${origin}/p/${pixelToken}.gif`,
    linkMap: Object.fromEntries(linkTokens.map((l) => [l.originalUrl, `${origin}/l/${l.token}`])),
  };

  if (typeof body.bodyLength === 'number' && body.bodyLength > LONG_MESSAGE_BEACON_THRESHOLD_BYTES) {
    const midToken = randomToken();
    const bottomToken = randomToken();
    await insertBeaconTokens(db, message.id, [
      { token: midToken, position: 'mid' },
      { token: bottomToken, position: 'bottom' },
    ]);
    response.beaconUrls = { mid: `${origin}/b/${midToken}.gif`, bottom: `${origin}/b/${bottomToken}.gif` };
  }

  return c.json(response, 201);
});

/**
 * Only http(s) URLs are worth rewriting into a tracked redirect — mailto:,
 * tel:, and malformed strings would just make `/l/:token` a confusing or
 * broken redirect target. Filtering here (rather than 400ing the whole
 * request) keeps a single bad link from blocking the rest of a legitimate
 * send, consistent with the fail-open philosophy elsewhere (NFR2).
 */
export function isTrackableUrl(candidate: string): boolean {
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
