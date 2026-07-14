import { describe, expect, it } from 'vitest';
import { authRoute } from '../src/routes/auth';

/** Same stub shape as billing-route.test.ts — see that file's comment. */
function rateLimiterDoStub(decision: { allowed: boolean; retryAfterSeconds: number }) {
  return {
    idFromName: () => 'fake-id',
    get: () => ({ fetch: async () => new Response(JSON.stringify(decision)) }),
  };
}

const BASE_ENV = { RATE_LIMIT_AUTH_IP_PER_MIN: '10', RATE_LIMIT_AUTH_ACCOUNT_PER_MIN: '5' };

describe('POST /v1/auth/provision', () => {
  it('rejects a request with no Authorization header before ever touching rate limiting or Supabase', async () => {
    const res = await authRoute.request('/v1/auth/provision', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rejects with 429 + Retry-After once the per-IP limit is exceeded, before ever calling Supabase', async () => {
    // A deliberately-invalid SUPABASE_URL: if the per-IP check didn't
    // short-circuit first, getSupabaseAnon()/auth.getUser() would blow up
    // against this bogus URL with something other than a clean 429 — this
    // proves the IP check genuinely runs BEFORE token verification, not
    // just that it exists somewhere in the handler.
    const res = await authRoute.request(
      '/v1/auth/provision',
      { method: 'POST', headers: { Authorization: 'Bearer some-token' } },
      { ...BASE_ENV, SUPABASE_URL: 'https://not-a-real-supabase-project.invalid', SUPABASE_ANON_KEY: 'irrelevant', RATE_LIMITER_DO: rateLimiterDoStub({ allowed: false, retryAfterSeconds: 30 }) },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain('this network');
  });
});
