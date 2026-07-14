import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { getSupabase, hasActiveSubscription } from '../db/client';
import { apiKeyAuth } from '../middleware/auth';
import { randomToken } from '../lib/crypto';
import { checkRateLimit, ONE_MINUTE_MS, rateLimitedResponse, readRateLimitInt } from '../lib/rate-limit';
import { isPdfMagicBytes } from '../lib/file-validation';

export const attachmentsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * ADR-42 (PDF tracking). A generous-but-bounded cap — big enough for a real
 * document, small enough that a single upload can't meaningfully dent the
 * R2 free tier or turn this into general file hosting.
 */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

attachmentsRoute.post('/v1/attachments', apiKeyAuth, async (c) => {
  const userId = c.get('userId');
  const attachmentsLimit = readRateLimitInt(c.env.RATE_LIMIT_ATTACHMENTS_PER_MIN, 10);
  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `attachments:${userId}`, { limit: attachmentsLimit, windowMs: ONE_MINUTE_MS, backoff: false });
  if (!allowed) return rateLimitedResponse(c, retryAfterSeconds);

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
  // ADR-46: the Content-Type header above is only ever a client claim — this
  // checks the actual bytes match the real PDF magic signature, so a
  // mislabeled non-PDF file (HTML, a script, anything) can't get stored and
  // later served back under a `Content-Type: application/pdf` header a
  // reader would trust.
  if (!isPdfMagicBytes(body)) {
    return c.json({ error: 'File content is not a valid PDF' }, 400);
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
  // ADR-46 (file upload safety): the Content-Type above is set unconditionally
  // here regardless of what's stored (the upload path already verified real
  // PDF magic bytes) — nosniff additionally stops a browser from ever
  // second-guessing that declared type and trying to execute/render the
  // response as something else (e.g. HTML), the standard defense against a
  // served file being treated as active content.
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Disposition', 'inline');
  return c.body(object.body);
});
