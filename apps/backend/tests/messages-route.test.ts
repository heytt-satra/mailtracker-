import { describe, expect, it } from 'vitest';
import { isTrackableUrl } from '../src/routes/messages';

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
