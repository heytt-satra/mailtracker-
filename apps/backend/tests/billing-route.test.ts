import { describe, expect, it } from 'vitest';
import { billingRoute } from '../src/routes/billing';

describe('billingRoute auth coverage', () => {
  it('POST /v1/billing/cancel requires an API key', async () => {
    const res = await billingRoute.request('/v1/billing/cancel', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('POST /v1/admin/grant-lifetime-subscriptions rejects a header that does not match the real admin secret', async () => {
    const res = await billingRoute.request(
      '/v1/admin/grant-lifetime-subscriptions',
      { method: 'POST', headers: { 'X-Admin-Secret': 'whatever-a-caller-might-guess' } },
      { ADMIN_SECRET: 'the-real-secret' },
    );
    expect(res.status).toBe(401);
  });

  it('POST /v1/admin/grant-lifetime-subscriptions rejects a request with no admin secret header at all', async () => {
    const res = await billingRoute.request('/v1/admin/grant-lifetime-subscriptions', { method: 'POST' }, { ADMIN_SECRET: 'the-real-secret' });
    expect(res.status).toBe(401);
  });
});
