import { describe, expect, it } from 'vitest';
import { computeReadSignal } from '../src/read-signal';

describe('computeReadSignal', () => {
  it('returns no signal for an empty history', () => {
    expect(computeReadSignal([])).toEqual({ readConfidence: null, minEngagedSeconds: null, readEvidence: null });
  });

  it('reports machine-only activity as not_verifiable, distinct from no data at all', () => {
    const result = computeReadSignal([{ verdict: 'machine_suspect', createdAt: '2026-01-01T00:00:00.000Z' }]);
    expect(result.readConfidence).toBe('not_verifiable');
    expect(result.minEngagedSeconds).toBeNull();
    expect(result.readEvidence).toMatch(/automated activity/i);
  });

  it('a single verified open is glanced, with no duration claimed', () => {
    const result = computeReadSignal([{ verdict: 'verified_open', createdAt: '2026-01-01T00:00:00.000Z' }]);
    expect(result.readConfidence).toBe('glanced');
    expect(result.minEngagedSeconds).toBeNull();
  });

  it('two or more verified opens is likely_read, still no fabricated duration', () => {
    const result = computeReadSignal([
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:00.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-02T00:00:00.000Z' },
    ]);
    expect(result.readConfidence).toBe('likely_read');
    expect(result.minEngagedSeconds).toBeNull();
    expect(result.readEvidence).toContain('2 separate times');
  });

  it('open followed by a click yields a proven minimum engaged-seconds bracket', () => {
    const result = computeReadSignal([
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:00.000Z' },
      { verdict: 'verified_click', createdAt: '2026-01-01T00:00:40.000Z' },
    ]);
    expect(result.readConfidence).toBe('read');
    expect(result.minEngagedSeconds).toBe(40);
    expect(result.readEvidence).toContain('at least 40s');
  });

  it('anchors the bracket to the LATEST open before the click, not the first', () => {
    const result = computeReadSignal([
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:00.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:55.000Z' },
      { verdict: 'verified_click', createdAt: '2026-01-01T00:01:00.000Z' },
    ]);
    expect(result.readConfidence).toBe('read');
    expect(result.minEngagedSeconds).toBe(5);
  });

  it('a click with no preceding open still counts as read but reports no bracket', () => {
    const result = computeReadSignal([{ verdict: 'verified_click', createdAt: '2026-01-01T00:00:00.000Z' }]);
    expect(result.readConfidence).toBe('read');
    expect(result.minEngagedSeconds).toBeNull();
  });

  it('click takes priority over machine-only noise mixed into the same history', () => {
    const result = computeReadSignal([
      { verdict: 'machine_suspect', createdAt: '2026-01-01T00:00:00.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:01.000Z' },
      { verdict: 'verified_click', createdAt: '2026-01-01T00:00:21.000Z' },
    ]);
    expect(result.readConfidence).toBe('read');
    expect(result.minEngagedSeconds).toBe(20);
  });

  it('never returns a negative duration even with out-of-order timestamps', () => {
    const result = computeReadSignal([
      { verdict: 'verified_click', createdAt: '2026-01-01T00:00:00.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:05.000Z' },
    ]);
    expect(result.minEngagedSeconds === null || result.minEngagedSeconds >= 0).toBe(true);
  });
});
