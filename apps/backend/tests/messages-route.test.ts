import { describe, expect, it } from 'vitest';
import { createMessageSchema, isTrackableUrl, messagesRoute } from '../src/routes/messages';

/** Same stand-in as billing-route.test.ts — these tests exercise auth/secret gating, not the rate limiter itself. */
const ALWAYS_ALLOW_RATE_LIMITER_DO = {
  idFromName: () => 'fake-id',
  get: () => ({ fetch: async () => new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 })) }),
};

describe('isTrackableUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isTrackableUrl('https://example.com/a')).toBe(true);
    expect(isTrackableUrl('http://example.com/a')).toBe(true);
  });

  it('rejects mailto:, tel:, javascript:, and other non-http(s) schemes', () => {
    expect(isTrackableUrl('mailto:a@b.com')).toBe(false);
    expect(isTrackableUrl('tel:+15551234567')).toBe(false);
    expect(isTrackableUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects malformed strings without throwing', () => {
    expect(isTrackableUrl('not a url')).toBe(false);
    expect(isTrackableUrl('')).toBe(false);
  });
});

describe('createMessageSchema (ADR-46 strict input validation)', () => {
  it('accepts a minimal valid body', () => {
    const result = createMessageSchema.safeParse({ linkUrls: [] });
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated valid body', () => {
    const result = createMessageSchema.safeParse({
      linkUrls: ['https://example.com/a', 'mailto:a@b.com'],
      gmailMessageId: 'gm-1',
      subject: 'Hello',
      recipient: 'a@b.com',
      bodyLength: 1234,
    });
    expect(result.success).toBe(true);
  });

  it('ADR-52: accepts non-http(s) or malformed hrefs in linkUrls rather than rejecting the whole request — real Gmail bodies routinely contain mailto:/cid:/anchor hrefs the extension sends as-is (extractLinkUrls does zero filtering), and isTrackableUrl() is the correct, separate place to filter those out (a filter, not a rejection, per NFR2)', () => {
    const result = createMessageSchema.safeParse({ linkUrls: ['mailto:a@b.com', 'cid:image001.png', '#anchor', 'not a url', ''] });
    expect(result.success).toBe(true);
  });

  it('rejects linkUrls exceeding the max count', () => {
    const result = createMessageSchema.safeParse({ linkUrls: Array.from({ length: 51 }, () => 'https://example.com') });
    expect(result.success).toBe(false);
  });

  it('rejects a missing linkUrls field', () => {
    const result = createMessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects an overlong subject instead of silently truncating it', () => {
    const result = createMessageSchema.safeParse({ linkUrls: [], subject: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('rejects an overlong recipient instead of silently truncating it', () => {
    const result = createMessageSchema.safeParse({ linkUrls: [], recipient: 'x'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('rejects a wrong-typed field (subject as a number)', () => {
    const result = createMessageSchema.safeParse({ linkUrls: [], subject: 12345 });
    expect(result.success).toBe(false);
  });

  it('rejects unexpected extra fields (.strict())', () => {
    const result = createMessageSchema.safeParse({ linkUrls: [], somethingUnexpected: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects a negative bodyLength', () => {
    const result = createMessageSchema.safeParse({ linkUrls: [], bodyLength: -1 });
    expect(result.success).toBe(false);
  });
});

describe('GET /v1/admin/beacon-timing (ADR-57, Track B Phase 0 diagnostic)', () => {
  it('rejects a request with no admin secret header at all', async () => {
    const res = await messagesRoute.request(
      '/v1/admin/beacon-timing?messageId=msg-1',
      { method: 'GET' },
      { ADMIN_SECRET: 'the-real-secret', RATE_LIMITER_DO: ALWAYS_ALLOW_RATE_LIMITER_DO },
    );
    expect(res.status).toBe(401);
  });

  it('rejects a header that does not match the real admin secret', async () => {
    const res = await messagesRoute.request(
      '/v1/admin/beacon-timing?messageId=msg-1',
      { method: 'GET', headers: { 'X-Admin-Secret': 'a-guess' } },
      { ADMIN_SECRET: 'the-real-secret', RATE_LIMITER_DO: ALWAYS_ALLOW_RATE_LIMITER_DO },
    );
    expect(res.status).toBe(401);
  });

  it('rejects requests once the per-IP admin rate limit is exceeded, even with a correct secret', async () => {
    const blockingRateLimiterDO = {
      idFromName: () => 'fake-id',
      get: () => ({ fetch: async () => new Response(JSON.stringify({ allowed: false, retryAfterSeconds: 42 })) }),
    };
    const res = await messagesRoute.request(
      '/v1/admin/beacon-timing?messageId=msg-1',
      { method: 'GET', headers: { 'X-Admin-Secret': 'the-real-secret' } },
      { ADMIN_SECRET: 'the-real-secret', RATE_LIMITER_DO: blockingRateLimiterDO },
    );
    expect(res.status).toBe(429);
  });

  it('requires the messageId query param even with a correct secret', async () => {
    const res = await messagesRoute.request(
      '/v1/admin/beacon-timing',
      { method: 'GET', headers: { 'X-Admin-Secret': 'the-real-secret' } },
      { ADMIN_SECRET: 'the-real-secret', RATE_LIMITER_DO: ALWAYS_ALLOW_RATE_LIMITER_DO },
    );
    expect(res.status).toBe(400);
  });
});
