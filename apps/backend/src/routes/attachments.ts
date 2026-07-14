import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { getSupabase, hasActiveSubscription } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { randomToken } from '../lib/crypto';

export const attachmentsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * ADR-42 (PDF tracking). A generous-but-bounded cap — big enough for a real
 * document, small enough that a single upload can't meaningfully dent the
 * R2 free tier or turn this into general file hosting.
 */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

attachmentsRoute.post('/v1/attachments', apiKeyAuth, async (c) => {
  const userId = c.get('userId');
  const { success } = await c.env.ATTACHMENTS_RATE_LIMITER.limit({ key: userId });
  if (!success) return c.json({ error: 'Rate limit exceeded' }, 429);

  // ADR-42, same gate as POST /v1/messages (ADR-36) — this costs real
  // storage, not just a request, so it's held to the same subscription
  // requirement as tracking a new message.
  const db = getSupabase(c.env);
  if (!(await hasActiveSubscription(db, userId))) {
    return c.json({ error: 'An active MailTrack subscription is required to upload attachments.' }, 402);
  }

  const contentType = c.req.header('Content-Type');
  if (contentType !== 'application/pdf') {
    return c.json({ error: 'Content-Type must be application/pdf' }, 400);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    return c.json({ error: 'Empty upload' }, 400);
  }
  if (body.byteLength > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: `File exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit` }, 413);
  }

  const token = randomToken();
  await c.env.ATTACHMENTS_BUCKET.put(token, body, { httpMetadata: { contentType: 'application/pdf' } });

  const origin = new URL(c.req.url).origin;
  return c.json({ url: `${origin}/attachments/${token}.pdf` }, 201);
});

// Deliberately unauthenticated and unlogged — tracking already happened one
// hop earlier, at the /l/:token click-classification layer (ADR-30-style
// per-link click detail), the same way any other tracked link works. This
// route's only job is to actually serve the bytes.
attachmentsRoute.get('/attachments/:token', async (c) => {
  const rawToken = c.req.param('token');
  const token = rawToken.endsWith('.pdf') ? rawToken.slice(0, -4) : rawToken;
  const object = await c.env.ATTACHMENTS_BUCKET.get(token);
  if (!object) return c.text('Not found', 404);

  c.header('Content-Type', 'application/pdf');
  c.header('Cache-Control', 'private, max-age=3600');
  return c.body(object.body);
});
