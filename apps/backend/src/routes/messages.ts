import { Hono } from 'hono';
import type { CreateMessageRequest, CreateMessageResponse } from '@mailtrack/shared';
import type { Env, Variables } from '../types';
import { getSupabase, insertLinkTokens, insertMessage } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { randomToken } from '../lib/crypto';

export const messagesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

messagesRoute.post('/v1/messages', apiKeyAuth, async (c) => {
  const body = await c.req.json<CreateMessageRequest>().catch(() => null);
  if (!body || !Array.isArray(body.linkUrls)) {
    return c.json({ error: 'Body must include linkUrls: string[]' }, 400);
  }

  const db = getSupabase(c.env);
  const userId = c.get('userId');
  const pixelToken = randomToken();

  const message = await insertMessage(db, { userId, gmailMessageId: body.gmailMessageId, pixelToken });

  const linkTokens = body.linkUrls.map((originalUrl) => ({ token: randomToken(), originalUrl }));
  await insertLinkTokens(db, message.id, linkTokens);

  const origin = new URL(c.req.url).origin;
  const response: CreateMessageResponse = {
    msgId: message.id,
    pixelUrl: `${origin}/p/${pixelToken}.gif`,
    linkMap: Object.fromEntries(linkTokens.map((l) => [l.originalUrl, `${origin}/l/${l.token}`])),
  };
  return c.json(response, 201);
});
