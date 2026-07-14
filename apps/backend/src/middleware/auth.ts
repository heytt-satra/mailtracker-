import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import { getSupabase, getUserByApiKeyHash } from '../db/client';
import { sha256Hex } from '../lib/crypto';
import { checkRateLimit, ONE_MINUTE_MS, rateLimitedResponse, readRateLimitInt } from '../lib/rate-limit';

/**
 * Per-install API key auth. Keys are never stored in plaintext (security
 * checklist item). ADR-45: also applies a blanket, generous per-user rate
 * limit here so EVERY authenticated route gets baseline coverage
 * automatically (previously several — billing, reports, the message list —
 * had none at all). Routes with a real cost driver (POST /v1/messages,
 * attachments) layer a stricter, route-specific limit on top of this one.
 */
export async function apiKeyAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const header = c.req.header('Authorization');
  const apiKey = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!apiKey) {
    return c.json({ error: 'Missing API key' }, 401);
  }

  const db = getSupabase(c.env);
  const hash = await sha256Hex(apiKey);
  const user = await getUserByApiKeyHash(db, hash);
  if (!user) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  const limit = readRateLimitInt(c.env.RATE_LIMIT_USER_ACTIONS_PER_MIN, 120);
  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `user-actions:${user.id}`, { limit, windowMs: ONE_MINUTE_MS, backoff: false });
  if (!allowed) return rateLimitedResponse(c, retryAfterSeconds);

  c.set('userId', user.id);
  await next();
}
