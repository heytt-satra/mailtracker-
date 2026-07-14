import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { getSupabase, getSupabaseAnon, upsertUserApiKey } from '../db/client';
import { randomToken, sha256Hex } from '../lib/crypto';
import { checkRateLimit, getClientIp, ONE_MINUTE_MS, rateLimitedResponse, readRateLimitInt } from '../lib/rate-limit';

export const authRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * The bridge between "you proved you're a human with this email via
 * Supabase Auth" (extension calls Supabase directly, client-side, with the
 * public anon key — see PLAN.md ADR-10) and "you have a MailTrack API key"
 * (everything else in this API, unchanged). Deliberately does NOT replace
 * the existing api-key auth middleware — Supabase Auth is only ever used as
 * a one-time identity gate here, not as the ongoing request-auth mechanism,
 * so every other route's tested, hardened auth path is untouched.
 *
 * ADR-45: two independent, backoff-enabled checks, not one flat limit.
 * Per-IP runs FIRST, before the token is ever verified — a bad actor
 * hammering this endpoint with garbage tokens (or someone else's valid
 * token, credential-stuffing style) shouldn't get free Supabase verification
 * calls just because each attempt uses a different account. Per-account
 * runs AFTER verification succeeds, keyed on the real Supabase user id —
 * this is what actually matters for "is this specific account being
 * abused" (e.g. a stolen session token used to spam key rotation), and
 * can't be checked before we know who the caller is. Both use exponential
 * backoff (see rate-limit-logic.ts) rather than a flat lockout: a fixed
 * window is trivially waited out by an attacker on a timer, but each
 * repeated violation here roughly doubles the wait.
 */
authRoute.post('/v1/auth/provision', async (c) => {
  const authHeader = c.req.header('Authorization');
  const supabaseAccessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!supabaseAccessToken) {
    return c.json({ error: 'Missing Supabase access token' }, 401);
  }

  const ip = getClientIp(c.req.header('CF-Connecting-IP'));
  const ipLimit = readRateLimitInt(c.env.RATE_LIMIT_AUTH_IP_PER_MIN, 10);
  const ipCheck = await checkRateLimit(c.env, `auth:ip:${ip}`, { limit: ipLimit, windowMs: ONE_MINUTE_MS, backoff: true });
  if (!ipCheck.allowed) return rateLimitedResponse(c, ipCheck.retryAfterSeconds, 'Too many attempts from this network. Try again later.');

  const supabaseAnon = getSupabaseAnon(c.env);
  const { data, error } = await supabaseAnon.auth.getUser(supabaseAccessToken);
  if (error || !data.user) {
    return c.json({ error: 'Invalid or expired Supabase session' }, 401);
  }

  const accountLimit = readRateLimitInt(c.env.RATE_LIMIT_AUTH_ACCOUNT_PER_MIN, 5);
  const accountCheck = await checkRateLimit(c.env, `auth:account:${data.user.id}`, { limit: accountLimit, windowMs: ONE_MINUTE_MS, backoff: true });
  if (!accountCheck.allowed) return rateLimitedResponse(c, accountCheck.retryAfterSeconds, 'Too many attempts on this account. Try again later.');

  const apiKey = randomToken() + randomToken(); // 256 bits total — this key is long-lived, unlike the 128-bit per-message tokens
  const apiKeyHash = await sha256Hex(apiKey);

  const db = getSupabase(c.env);
  await upsertUserApiKey(db, { authUserId: data.user.id, email: data.user.email ?? null, apiKeyHash });

  return c.json({ apiKey, email: data.user.email ?? null });
});

/**
 * Landing page for Supabase's email-confirmation link. MailTrack has no
 * regular website — without this, Supabase falls back to its default Site
 * URL (typically an unconfigured `localhost`, since nobody set one up for a
 * project whose only client is a Chrome extension), which is exactly the
 * "localhost refused to connect" dead end this route exists to fix. Wired
 * up via `emailRedirectTo` in the extension's signUp() call (ADR-10);
 * confirmation itself already happened server-side by the time the browser
 * lands here, so this page's only job is to say so and send the user back.
 */
authRoute.get('/auth/confirmed', (c) => {
  return c.html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>MailTrack — you're confirmed</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 420px; margin: 4rem auto; text-align: center; color: #202124; }
      h1 { font-size: 1.1rem; }
      p { color: #5f6368; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <h1>You're confirmed.</h1>
    <p>Go back to the MailTrack extension's options page and log in with your email and password.</p>
    <p>You can close this tab.</p>
  </body>
</html>`);
});
