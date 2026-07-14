import { describe, expect, it } from 'vitest';
import { createMessageSchema, isTrackableUrl } from '../src/routes/messages';

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

  it('rejects a non-URL string in linkUrls instead of silently dropping it', () => {
    const result = createMessageSchema.safeParse({ linkUrls: ['not a url'] });
    expect(result.success).toBe(false);
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
