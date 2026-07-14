import { describe, expect, it } from 'vitest';
import { getClientIp, readRateLimitInt } from '../src/lib/rate-limit';

describe('readRateLimitInt', () => {
  it('parses a valid positive integer var', () => {
    expect(readRateLimitInt('42', 10)).toBe(42);
  });

  it('falls back to the default when the var is unset', () => {
    expect(readRateLimitInt(undefined, 10)).toBe(10);
  });

  it('falls back to the default on a non-numeric var, rather than NaN letting every request through', () => {
    expect(readRateLimitInt('not-a-number', 10)).toBe(10);
  });

  it('falls back to the default on zero or negative values, rather than blocking every request', () => {
    expect(readRateLimitInt('0', 10)).toBe(10);
    expect(readRateLimitInt('-5', 10)).toBe(10);
  });

  it('falls back to the default on a non-integer value', () => {
    expect(readRateLimitInt('3.5', 10)).toBe(10);
  });
});

describe('getClientIp', () => {
  it('returns the header value when present', () => {
    expect(getClientIp('203.0.113.1')).toBe('203.0.113.1');
  });

  it('returns "unknown" when the header is missing or null', () => {
    expect(getClientIp(undefined)).toBe('unknown');
    expect(getClientIp(null)).toBe('unknown');
  });
});
