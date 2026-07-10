import { describe, expect, it } from 'vitest';
import { computeReadSignal } from '../src/read-signal';

describe('computeReadSignal', () => {
  it('returns no signal for an empty history', () => {
    expect(computeReadSignal([])).toEqual({ readConfidence: null, minEngagedSeconds: null, readEvidence: null, sessionCount: null, syncSuspect: false });
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

  it('opens on two separate days are two sessions -> likely_read (ADR-22 session clustering)', () => {
    const result = computeReadSignal([
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:00.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-02T00:00:00.000Z' },
    ]);
    expect(result.readConfidence).toBe('likely_read');
    expect(result.minEngagedSeconds).toBeNull();
    expect(result.sessionCount).toBe(2);
    expect(result.readEvidence).toContain('2 distinct sessions');
  });

  it('several rapid re-fetches in one sitting are ONE session -> glanced, not repeat engagement (the "opened 5 times?" fix)', () => {
    const result = computeReadSignal([
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:00.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:10.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-01T00:01:00.000Z' },
    ]);
    expect(result.readConfidence).toBe('glanced');
    expect(result.sessionCount).toBe(1);
    expect(result.readEvidence).toMatch(/single session/i);
  });

  it('the real-world example: opens at 0/15/27/89/516 min -> 3 sessions -> likely_read', () => {
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const at = (min: number) => new Date(base + min * 60000).toISOString();
    const result = computeReadSignal([0, 15, 27, 89, 516].map((m) => ({ verdict: 'verified_open' as const, createdAt: at(m) })));
    expect(result.sessionCount).toBe(3); // {0,15,27} {89} {516}
    expect(result.readConfidence).toBe('likely_read');
  });

  it('clockwork-regular opens spanning session gaps are flagged syncSuspect with a caveat in the evidence', () => {
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const at = (min: number) => new Date(base + min * 60000).toISOString();
    // every 45 min, four opens — regular and wider than the 30-min session gap
    const result = computeReadSignal([0, 45, 90, 135].map((m) => ({ verdict: 'verified_open' as const, createdAt: at(m) })));
    expect(result.syncSuspect).toBe(true);
    expect(result.readEvidence).toMatch(/automated mail sync/i);
  });

  it('irregular human-looking opens spanning session gaps are NOT flagged syncSuspect', () => {
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const at = (min: number) => new Date(base + min * 60000).toISOString();
    const result = computeReadSignal([0, 40, 200, 205].map((m) => ({ verdict: 'verified_open' as const, createdAt: at(m) })));
    expect(result.syncSuspect).toBe(false);
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
