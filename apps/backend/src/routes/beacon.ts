import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { classifyIpCategory, getMessageByBeaconToken, getSupabase, insertRawEvent } from '../db/client';
import { classifyAndApplyOne } from '../classifier/classify-and-apply';
import { getRequestAsn } from '../lib/cf';
import { sha256Hex } from '../lib/crypto';

/**
 * Track B depth beacons (ADR-19): mid/bottom tracking images, generated only
 * for messages long enough to plausibly hit Gmail's clip threshold (see
 * LONG_MESSAGE_BEACON_THRESHOLD_BYTES in routes/messages.ts). Deliberately a
 * separate route and token namespace from routes/pixel.ts's `/p/:token`,
 * mirroring its exact fail-open/no-cache/no-validity-leak design, so nothing
 * about this addition can put the original, reliable open-detection path at
 * risk (same reasoning as ADR-15's classify-and-apply extraction).
 */
export const beaconRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

const PIXEL_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';
const PIXEL_GIF_BYTES = Uint8Array.from(atob(PIXEL_GIF_BASE64), (c) => c.charCodeAt(0));

beaconRoute.get('/b/:token', async (c) => {
  const rawToken = c.req.param('token');
  const token = rawToken.endsWith('.gif') ? rawToken.slice(0, -4) : rawToken;

  c.executionCtx.waitUntil(logBeaconFetch(c.env, token, c.req.raw));

  c.header('Content-Type', 'image/gif');
  c.header('Cache-Control', 'no-store, private, max-age=0');
  return c.body(PIXEL_GIF_BYTES);
});

async function logBeaconFetch(env: Env, beaconToken: string, request: Request): Promise<void> {
  try {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.PUBLIC_RATE_LIMITER.limit({ key: ip });
    if (!success) return;

    const db = getSupabase(env);
    const found = await getMessageByBeaconToken(db, beaconToken);
    if (!found) return; // unknown/expired token: nothing to log, pixel already returned above
    const { message, position } = found;

    const { asn } = getRequestAsn(request);
    const headers: Record<string, string> = {};
    for (const [key, value] of request.headers.entries()) {
      if (key.toLowerCase() === 'cookie' || key.toLowerCase() === 'authorization') continue;
      headers[key] = value;
    }

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
      beaconPosition: position,
    });

    // Same classifier, same rules as the primary pixel (ADR-19 doesn't change
    // WHAT counts as a verified open, only WHERE in the body it was seen) —
    // classified inline for the same reason as ADR-15: no reason to make a
    // depth signal wait for the once-a-minute cron fallback either.
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
    // Logging failures must never surface to the client; the pixel response has already been sent.
  }
}
