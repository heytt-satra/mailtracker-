import { describe, expect, it } from 'vitest';
import { createOrgSchema, joinOrgSchema, organizationsRoute } from '../src/routes/organizations';

describe('createOrgSchema (ADR-60)', () => {
  it('accepts a normal team name', () => {
    expect(createOrgSchema.safeParse({ name: 'Acme Sales' }).success).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(createOrgSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects a name over 100 characters', () => {
    expect(createOrgSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });

  it('rejects unexpected extra fields (.strict())', () => {
    expect(createOrgSchema.safeParse({ name: 'Acme', extra: 'x' }).success).toBe(false);
  });
});

describe('joinOrgSchema (ADR-60)', () => {
  it('accepts a normal invite code', () => {
    expect(joinOrgSchema.safeParse({ code: 'abc123' }).success).toBe(true);
  });

  it('rejects an empty code', () => {
    expect(joinOrgSchema.safeParse({ code: '' }).success).toBe(false);
  });

  it('rejects a missing code field', () => {
    expect(joinOrgSchema.safeParse({}).success).toBe(false);
  });
});

describe('organizationsRoute auth coverage (ADR-60)', () => {
  const endpoints: Array<{ method: string; path: string }> = [
    { method: 'POST', path: '/v1/orgs' },
    { method: 'GET', path: '/v1/orgs/me' },
    { method: 'POST', path: '/v1/orgs/invite' },
    { method: 'POST', path: '/v1/orgs/join' },
    { method: 'POST', path: '/v1/orgs/leave' },
    { method: 'DELETE', path: '/v1/orgs' },
    { method: 'GET', path: '/v1/orgs/messages' },
  ];

  for (const { method, path } of endpoints) {
    it(`${method} ${path} requires an API key`, async () => {
      const res = await organizationsRoute.request(path, { method });
      expect(res.status).toBe(401);
    });
  }
});
