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

  it('a SINGLE verified open is already likely_read, with no duration claimed (ADR-29)', () => {
    // A verified_open only exists after passing the classifier's full
    // human-vs-machine check (timing window, UA, ASN, burst) — it is never a
    // raw notification-preview fetch, so one is already real signal.
    const result = computeReadSignal([{ verdict: 'verified_open', createdAt: '2026-01-01T00:00:00.000Z' }]);
    expect(result.readConfidence).toBe('likely_read');
    expect(result.minEngagedSeconds).toBeNull();
    expect(result.readEvidence).toMatch(/consistent with a human reading/i);
  });

  it('a single verified open mixed with machine-only noise still resolves to likely_read', () => {
    const result = computeReadSignal([
      { verdict: 'machine_suspect', createdAt: '2026-01-01T00:00:00.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:05.000Z' },
    ]);
    expect(result.readConfidence).toBe('likely_read');
  });

  it('two verified opens -> likely_read, still (ADR-28/29: tier is driven by verified-open count)', () => {
    const result = computeReadSignal([
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:00.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-02T00:00:00.000Z' },
    ]);
    expect(result.readConfidence).toBe('likely_read');
    expect(result.minEngagedSeconds).toBeNull();
    expect(result.sessionCount).toBe(2);
  });

  it('several verified render-fetches from one real open -> likely_read (the reported regression fix)', () => {
    // Gmail fires multiple proxy fetches for a single genuine open. These must
    // read as "likely_read" (the message was actively rendered/viewed), NOT
    // "glanced" — which is exactly what ADR-22 wrongly did by collapsing them.
    const result = computeReadSignal([
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:00.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-01T00:00:10.000Z' },
      { verdict: 'verified_open', createdAt: '2026-01-01T00:01:00.000Z' },
    ]);
    expect(result.readConfidence).toBe('likely_read');
    expect(result.readEvidence).toMatch(/consistent with a human reading/i);
  });

  it('opens spread minutes apart -> likely_read, session count surfaced for context (ADR-26/28)', () => {
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const at = (min: number) => new Date(base + min * 60000).toISOString();
    // 0, 15, 27, 89, 516 min -> every gap > 5 min -> five distinct sessions
    const result = computeReadSignal([0, 15, 27, 89, 516].map((m) => ({ verdict: 'verified_open' as const, createdAt: at(m) })));
    expect(result.sessionCount).toBe(5);
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
