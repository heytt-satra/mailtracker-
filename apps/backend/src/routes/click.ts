import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { classifyIpCategory, getLinkToken, getSupabase, insertRawEvent } from '../db/client';
import { getRequestAsn } from '../lib/cf';
import { sha256Hex } from '../lib/crypto';

export const clickRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

clickRoute.get('/l/:token', async (c) => {
  const db = getSupabase(c.env);
  const token = c.req.param('token');
  const link = await getLinkToken(db, token);

  // Unlike the pixel (which always returns the same image to avoid leaking
  // token validity), a click has nowhere safe to redirect to if the token is
  // unknown — there is no "original URL" to fall back to. A 404 here reveals
  // only that the token is invalid, not any information about the message.
  if (!link) {
    return c.text('Not found', 404);
  }

  // Log in the background: the human is already mid-navigation, don't make
  // them wait on our insert. A click is always verified_click regardless of
  // how long logging takes (classifier rules.ts short-circuits on kind).
  c.executionCtx.waitUntil(
    (async () => {
      const { asn } = getRequestAsn(c.req.raw);
      const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
      const ipCategory = await classifyIpCategory(db, ip).catch(() => null);
      await insertRawEvent(db, {
        messageId: link.messageId,
        kind: 'link_click',
        userAgent: c.req.header('User-Agent') ?? null,
        ipHash: await sha256Hex(ip),
        ipCategory,
        asn,
        headers: {},
        fetchSequenceMs: Date.now() - new Date(link.sentAt).getTime(),
      }).catch(() => {});
    })(),
  );

  return c.redirect(link.originalUrl, 302);
});
