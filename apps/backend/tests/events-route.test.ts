import { describe, expect, it } from 'vitest';
import { eventsRoute } from '../src/routes/events';

/**
 * ADR-30 regression guard: /v1/events/poll was never covered by
 * eventsRoute's apiKeyAuth middleware registration (only '/v1/messages' and
 * '/v1/messages/*' were), so c.get('userId') was undefined and the query
 * failed with a Postgres "invalid input syntax for type uuid: undefined"
 * error on every single call — the actual reason notifications never
 * worked, found by tailing live Worker logs against a real request rather
 * than assuming the fix in ADR-30's other two bugs was sufficient.
 *
 * apiKeyAuth returns 401 before ever touching the database when there's no
 * Authorization header, so this test needs no DB/env mocking — it directly
 * proves the route is actually gated, which a passing query-logic test
 * alone (see poll-updates.test.ts) would never have caught, since that
 * logic is only reachable once auth has already let the request through.
 */
describe('eventsRoute auth coverage (ADR-30)', () => {
  it('GET /v1/events/poll requires an API key — 401 without one, not a 500 from an undefined user id', async () => {
    const res = await eventsRoute.request('/v1/events/poll');
    expect(res.status).toBe(401);
  });

  it('every /v1/messages* route also requires an API key', async () => {
    const paths = ['/v1/messages', '/v1/messages/abc/status', '/v1/messages/abc/events', '/v1/messages/abc'];
    for (const path of paths) {
      const res = await eventsRoute.request(path);
      expect(res.status).toBe(401);
    }
  });
});
