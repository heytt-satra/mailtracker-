import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { classifyIpCategory, getMessageByPixelToken, getSupabase, insertRawEvent } from '../db/client';
import { classifyAndApplyOne } from '../classifier/classify-and-apply';
import { getRequestAsn } from '../lib/cf';
import { sha256Hex } from '../lib/crypto';

export const pixelRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// Smallest valid transparent GIF, 43 bytes. Served byte-for-byte identical on
// every request (no per-request encoding cost) and NEVER varies based on
// whether the token is valid — leaking that distinction would let an
// attacker enumerate valid tracking tokens (security checklist item).
const PIXEL_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';
const PIXEL_GIF_BYTES = Uint8Array.from(atob(PIXEL_GIF_BASE64), (c) => c.charCodeAt(0));

pixelRoute.get('/p/:token', async (c) => {
  const rawToken = c.req.param('token');
  const token = rawToken.endsWith('.gif') ? rawToken.slice(0, -4) : rawToken;

  // Fail open (NFR2): the GIF is written to the response immediately. All DB
  // work happens in waitUntil, AFTER the response is already flushed to the
  // client, so classification/logging can never add latency to the pixel
  // fetch itself (ADR-1).
  c.executionCtx.waitUntil(logPixelFetch(c.env, token, c.req.raw));

  c.header('Content-Type', 'image/gif');
  c.header('Cache-Control', 'no-store, private, max-age=0'); // ADR-4: repeat opens must be observable
  return c.body(PIXEL_GIF_BYTES);
});

async function logPixelFetch(env: Env, pixelToken: string, request: Request): Promise<void> {
  try {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    // Rate limit is checked here, in the background task, never on the
    // response path — the pixel itself always returns 200 with the same
    // bytes regardless (no validity leak, ADR from pixel.ts header comment).
    // Exceeding the limit just means this fetch isn't logged; it does not
    // change what the requester sees.
    const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key: ip });
    if (!success) return;

    const db = getSupabase(env);
    const message = await getMessageByPixelToken(db, pixelToken);
    if (!message) return; // unknown/expired token: nothing to log, pixel already returned above

    const { asn } = getRequestAsn(request);
    const headers: Record<string, string> = {};
    for (const [key, value] of request.headers.entries()) {
      if (key.toLowerCase() === 'cookie' || key.toLowerCase() === 'authorization') continue; // never log credentials
      headers[key] = value;
    }

    // Resolved here, once, while the raw IP is still in hand (NFR4: only the
    // hash is persisted below). See ADR-8 for why this is IP-range based
    // rather than ASN based.
    const ipCategory = await classifyIpCategory(db, ip).catch(() => null);

    const occurredAt = new Date();
    const userAgent = request.headers.get('User-Agent');
    const fetchSequenceMs = occurredAt.getTime() - new Date(message.sent_at).getTime();

    const rawEvent = await insertRawEvent(db, {
      messageId: message.id,
      kind: 'pixel_fetch',
      userAgent,
      ipHash: await sha256Hex(ip),
      ipCategory,
      asn,
      headers,
      fetchSequenceMs,
      occurredAt: occurredAt.toISOString(),
    });

    // ADR-15: classify immediately, in this same background task, instead
    // of waiting for the next per-minute cron sweep — still entirely after
    // the pixel response was already sent, so this can never slow down the
    // fetch itself (ADR-1's actual constraint). A real user hitting a
    // near-60-second lag before an open showed up anywhere is what
    // triggered this; the cron sweep (sweep.ts) remains as a fallback for
    // whatever this async task doesn't get to finish.
    await classifyAndApplyOne(db, {
      id: rawEvent.id,
      message_id: message.id,
      kind: 'pixel_fetch',
      occurred_at: rawEvent.occurredAt,
      user_agent: userAgent,
      asn,
      ip_category: ipCategory,
      fetch_sequence_ms: fetchSequenceMs,
    });
  } catch {
    // Logging failures must never surface to the client; the pixel response
    // has already been sent. Swallow and rely on the classifier sweep
    // fallback picking up anything that didn't finish here.
  }
}
