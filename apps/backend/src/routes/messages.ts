import { Hono } from 'hono';
import type { CreateMessageRequest, CreateMessageResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { getSupabase, insertLinkTokens, insertMessage } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { randomToken } from '../lib/crypto';

export const messagesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// A real email body doesn't have hundreds of distinct links; this is a
// sanity cap against a malformed/malicious client turning one send into an
// unbounded batch insert, not a business rule.
const MAX_LINK_URLS = 50;

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

  const db = getSupabase(c.env);
  const userId = c.get('userId');
  const pixelToken = randomToken();

  const message = await insertMessage(db, { userId, gmailMessageId: body.gmailMessageId, pixelToken });

  const linkTokens = validLinkUrls.map((originalUrl) => ({ token: randomToken(), originalUrl }));
  await insertLinkTokens(db, message.id, linkTokens);

  const origin = new URL(c.req.url).origin;
  const response: CreateMessageResponse = {
    msgId: message.id,
    pixelUrl: `${origin}/p/${pixelToken}.gif`,
    linkMap: Object.fromEntries(linkTokens.map((l) => [l.originalUrl, `${origin}/l/${l.token}`])),
  };
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
