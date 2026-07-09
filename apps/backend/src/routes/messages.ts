import { Hono } from 'hono';
import type { CreateMessageRequest, CreateMessageResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { getSupabase, insertBeaconTokens, insertLinkTokens, insertMessage } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { randomToken } from '../lib/crypto';

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
// this for a dashboard list row; truncating rather than rejecting keeps a
// long subject from blocking an otherwise-normal send (NFR2 fail-open spirit).
const MAX_SUBJECT_LENGTH = 500;
const MAX_RECIPIENT_LENGTH = 500;

messagesRoute.post('/v1/messages', apiKeyAuth, async (c) => {
  // Bounds the blast radius of a leaked/compromised API key — 30 tracked
  // sends/minute is generous for a human composing email, well below what a
  // spam/abuse script would want to do with a stolen key.
  const { success } = await c.env.MESSAGES_RATE_LIMITER.limit({ key: c.get('userId') });
  if (!success) return c.json({ error: 'Rate limit exceeded' }, 429);

  const body = await c.req.json<CreateMessageRequest>().catch(() => null);
  if (!body || !Array.isArray(body.linkUrls)) {
    return c.json({ error: 'Body must include linkUrls: string[]' }, 400);
  }
  if (body.linkUrls.length > MAX_LINK_URLS) {
    return c.json({ error: `linkUrls exceeds the maximum of ${MAX_LINK_URLS}` }, 400);
  }
  const validLinkUrls = body.linkUrls.filter(isTrackableUrl);
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, MAX_SUBJECT_LENGTH) || undefined : undefined;
  const recipient = typeof body.recipient === 'string' ? body.recipient.trim().slice(0, MAX_RECIPIENT_LENGTH) || undefined : undefined;

  const db = getSupabase(c.env);
  const userId = c.get('userId');
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
