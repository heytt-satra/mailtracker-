import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { getSupabase, getSupabaseAnon, upsertUserApiKey } from '../db/client';
import { randomToken, sha256Hex } from '../lib/crypto';

export const authRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * The bridge between "you proved you're a human with this email via
 * Supabase Auth" (extension calls Supabase directly, client-side, with the
 * public anon key — see PLAN.md ADR-10) and "you have a MailTrack API key"
 * (everything else in this API, unchanged). Deliberately does NOT replace
 * the existing api-key auth middleware — Supabase Auth is only ever used as
 * a one-time identity gate here, not as the ongoing request-auth mechanism,
 * so every other route's tested, hardened auth path is untouched.
 */
authRoute.post('/v1/auth/provision', async (c) => {
  const authHeader = c.req.header('Authorization');
  const supabaseAccessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!supabaseAccessToken) {
    return c.json({ error: 'Missing Supabase access token' }, 401);
  }

  const { success } = await c.env.AUTH_RATE_LIMITER.limit({ key: c.req.header('CF-Connecting-IP') ?? 'unknown' });
  if (!success) return c.json({ error: 'Rate limit exceeded' }, 429);

  const supabaseAnon = getSupabaseAnon(c.env);
  const { data, error } = await supabaseAnon.auth.getUser(supabaseAccessToken);
  if (error || !data.user) {
    return c.json({ error: 'Invalid or expired Supabase session' }, 401);
  }

  const apiKey = randomToken() + randomToken(); // 256 bits total — this key is long-lived, unlike the 128-bit per-message tokens
  const apiKeyHash = await sha256Hex(apiKey);

  const db = getSupabase(c.env);
  await upsertUserApiKey(db, { authUserId: data.user.id, email: data.user.email ?? null, apiKeyHash });

  return c.json({ apiKey, email: data.user.email ?? null });
});
