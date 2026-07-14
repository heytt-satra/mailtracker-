import { describe, expect, it } from 'vitest';
import { billingRoute } from '../src/routes/billing';

/**
 * Minimal stand-in for the RATE_LIMITER_DO binding (ADR-45) — these route
 * tests exercise auth/secret gating, not the rate limiter itself (that's
 * covered directly by rate-limit-logic.test.ts), so this stub always
 * allows. Shaped to match exactly what lib/rate-limit.ts::checkRateLimit
 * calls: idFromName() then get() then fetch().
 */
const ALWAYS_ALLOW_RATE_LIMITER_DO = {
  idFromName: () => 'fake-id',
  get: () => ({
    fetch: async () => new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 })),
  }),
};

describe('billingRoute auth coverage', () => {
  it('POST /v1/billing/cancel requires an API key', async () => {
    const res = await billingRoute.request('/v1/billing/cancel', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('POST /v1/admin/grant-lifetime-subscriptions rejects a header that does not match the real admin secret', async () => {
    const res = await billingRoute.request(
      '/v1/admin/grant-lifetime-subscriptions',
      { method: 'POST', headers: { 'X-Admin-Secret': 'whatever-a-caller-might-guess' } },
      { ADMIN_SECRET: 'the-real-secret', RATE_LIMITER_DO: ALWAYS_ALLOW_RATE_LIMITER_DO },
    );
    expect(res.status).toBe(401);
  });

  it('POST /v1/admin/grant-lifetime-subscriptions rejects a request with no admin secret header at all', async () => {
    const res = await billingRoute.request(
      '/v1/admin/grant-lifetime-subscriptions',
      { method: 'POST' },
      { ADMIN_SECRET: 'the-real-secret', RATE_LIMITER_DO: ALWAYS_ALLOW_RATE_LIMITER_DO },
    );
    expect(res.status).toBe(401);
  });

  it('POST /v1/admin/grant-lifetime-subscriptions rejects requests once the per-IP admin rate limit is exceeded, even with a correct secret', async () => {
    const blockingRateLimiterDO = {
      idFromName: () => 'fake-id',
      get: () => ({ fetch: async () => new Response(JSON.stringify({ allowed: false, retryAfterSeconds: 42 })) }),
    };
    const res = await billingRoute.request(
      '/v1/admin/grant-lifetime-subscriptions',
      { method: 'POST', headers: { 'X-Admin-Secret': 'the-real-secret' } },
      { ADMIN_SECRET: 'the-real-secret', RATE_LIMITER_DO: blockingRateLimiterDO },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
  });

  it('POST /v1/admin/grant-lifetime-subscription (singular) requires the correct admin secret', async () => {
    const res = await billingRoute.request(
      '/v1/admin/grant-lifetime-subscription',
      { method: 'POST', headers: { 'X-Admin-Secret': 'wrong', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.com' }) },
      { ADMIN_SECRET: 'the-real-secret', RATE_LIMITER_DO: ALWAYS_ALLOW_RATE_LIMITER_DO },
    );
    expect(res.status).toBe(401);
  });

  it('POST /v1/admin/grant-lifetime-subscription (singular) rejects a malformed email before ever touching the database', async () => {
    const res = await billingRoute.request(
      '/v1/admin/grant-lifetime-subscription',
      { method: 'POST', headers: { 'X-Admin-Secret': 'the-real-secret', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'not-an-email' }) },
      { ADMIN_SECRET: 'the-real-secret', RATE_LIMITER_DO: ALWAYS_ALLOW_RATE_LIMITER_DO },
    );
    expect(res.status).toBe(400);
  });
});
