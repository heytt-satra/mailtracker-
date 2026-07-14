import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import type { RateLimitConfig } from '../rate-limit-logic';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Routes a rate-limit check to the Durable Object instance for this key —
 * Cloudflare pins one instance per idFromName() value, so two calls with
 * the same key always hit the same counter regardless of which edge
 * location handled the request. `key` should already be namespaced (e.g.
 * `auth:ip:1.2.3.4`, `messages:user:<uuid>`) since DO instances are shared
 * across the whole binding, not scoped per caller.
 */
export async function checkRateLimit(env: Env, key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const id = env.RATE_LIMITER_DO.idFromName(key);
  const stub = env.RATE_LIMITER_DO.get(id);
  const response = await stub.fetch('https://rate-limiter.internal/check', {
    method: 'POST',
    body: JSON.stringify(config),
  });
  return response.json();
}

/** The one shared IP-extraction helper — previously duplicated independently in auth.ts/beacon.ts/click.ts/pixel.ts. */
export function getClientIp(headerValue: string | undefined | null): string {
  return headerValue ?? 'unknown';
}

/**
 * Thresholds live in wrangler.toml `[vars]` (RATE_LIMIT_*), not hardcoded in
 * route files — an operator can retune them without touching code, just a
 * `wrangler deploy` after editing the var. `raw` is always a string (or
 * undefined if the var was never set); falls back to `fallback` on anything
 * that doesn't parse to a positive integer, so a typo'd var fails toward the
 * previous safe default instead of silently becoming 0 (which would block
 * every request) or NaN (which would let every request through).
 */
export function readRateLimitInt(raw: string | undefined, fallback: number): number {
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const ONE_MINUTE_MS = 60_000;

/** Consistent 429 shape across every rate-limited route, with a standard Retry-After header so a well-behaved client knows exactly how long to wait. */
export function rateLimitedResponse(c: Context<{ Bindings: Env; Variables: Variables }>, retryAfterSeconds: number, message = 'Rate limit exceeded') {
  c.header('Retry-After', String(retryAfterSeconds));
  return c.json({ error: message, retryAfterSeconds }, 429);
}
