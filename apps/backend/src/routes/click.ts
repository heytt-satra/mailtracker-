import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { classifyIpCategory, getLinkToken, getSupabase, insertRawEvent } from '../db/client';
import { classifyAndApplyOne } from '../classifier/classify-and-apply';
import { getRequestAsn } from '../lib/cf';
import { sha256Hex } from '../lib/crypto';
import { checkRateLimit, getClientIp, ONE_MINUTE_MS, readRateLimitInt } from '../lib/rate-limit';

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
  // them wait on our insert. Classified immediately within this same
  // background task (ADR-15) rather than deferred to the once-a-minute
  // cron sweep — a click should reflect as "Clicked" within seconds, not
  // up to a minute later.
  c.executionCtx.waitUntil(
    (async () => {
      const ip = getClientIp(c.req.header('CF-Connecting-IP'));
      // Same soft rate-limit pattern as the pixel: never affects the
      // redirect the human is already following, only whether this fetch
      // gets logged for classification.
      const publicLimit = readRateLimitInt(c.env.RATE_LIMIT_PUBLIC_PER_MIN, 60);
      const { allowed } = await checkRateLimit(c.env, `public:${ip}`, { limit: publicLimit, windowMs: ONE_MINUTE_MS, backoff: false });
      if (!allowed) return;

      const { asn } = getRequestAsn(c.req.raw);
      const ipCategory = await classifyIpCategory(db, ip).catch(() => null);
      const occurredAt = new Date();
      const userAgent = c.req.header('User-Agent') ?? null;
      const fetchSequenceMs = occurredAt.getTime() - new Date(link.sentAt).getTime();

      const rawEvent = await insertRawEvent(db, {
        messageId: link.messageId,
        kind: 'link_click',
        userAgent,
        ipHash: await sha256Hex(ip),
        ipCategory,
        asn,
        headers: {},
        fetchSequenceMs,
        occurredAt: occurredAt.toISOString(),
        clickedUrl: link.originalUrl, // ADR-30: which link, not just "a link"
      }).catch(() => null);
      if (!rawEvent) return;

      await classifyAndApplyOne(db, {
        id: rawEvent.id,
        message_id: link.messageId,
        kind: 'link_click',
        occurred_at: rawEvent.occurredAt,
        user_agent: userAgent,
        asn,
        ip_category: ipCategory,
        fetch_sequence_ms: fetchSequenceMs,
      }).catch(() => {});
    })(),
  );

  return c.redirect(link.originalUrl, 302);
});
