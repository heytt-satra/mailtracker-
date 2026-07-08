import { describe, expect, it } from 'vitest';
import { formatSentAt, truncateSubject } from '../src/dashboard-format';

describe('formatSentAt', () => {
  it('formats a valid ISO timestamp into a locale date/time string', () => {
    const result = formatSentAt('2026-07-08T12:00:00.000Z');
    expect(result).not.toBe('2026-07-08T12:00:00.000Z');
    expect(result.length).toBeGreaterThan(0);
  });

  it('falls back to the raw string for an invalid timestamp rather than throwing', () => {
    expect(formatSentAt('not-a-date')).toBe('not-a-date');
  });
});

describe('truncateSubject', () => {
  it('returns a placeholder for null/empty subjects', () => {
    expect(truncateSubject(null)).toBe('(no subject)');
    expect(truncateSubject('')).toBe('(no subject)');
  });

  it('passes short subjects through unchanged', () => {
    expect(truncateSubject('Hello there')).toBe('Hello there');
  });

  it('truncates long subjects with an ellipsis at the configured length', () => {
    const long = 'x'.repeat(100);
    const result = truncateSubject(long, 80);
    expect(result.length).toBe(80);
    expect(result.endsWith('…')).toBe(true);
  });
});
