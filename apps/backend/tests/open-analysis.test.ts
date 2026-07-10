import { describe, expect, it } from 'vitest';
import { clusterOpenSessions, detectSyncPattern } from '../src/open-analysis';

const base = new Date('2026-01-01T00:00:00.000Z').getTime();
const at = (min: number) => new Date(base + min * 60000).toISOString();

describe('clusterOpenSessions', () => {
  it('returns no sessions for no opens', () => {
    expect(clusterOpenSessions([])).toEqual([]);
  });

  it('a single open is one session', () => {
    expect(clusterOpenSessions([at(0)])).toHaveLength(1);
  });

  it('opens within the 5-min gap collapse into one session', () => {
    // 0, 2, 4 min apart — each consecutive gap <= 5 min, so one sitting.
    expect(clusterOpenSessions([at(0), at(2), at(4)])).toHaveLength(1);
  });

  it('an open past the 5-min gap starts a new session', () => {
    const sessions = clusterOpenSessions([at(0), at(2), at(20)]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toHaveLength(2);
    expect(sessions[1]).toHaveLength(1);
  });

  it('a burst of pixel fetches for a single open stays one session', () => {
    // Gmail fires several fetches seconds apart for one open — must not inflate.
    const base2 = new Date('2026-01-01T00:00:00.000Z').getTime();
    const sec = (s: number) => new Date(base2 + s * 1000).toISOString();
    expect(clusterOpenSessions([sec(0), sec(8), sec(20), sec(45)])).toHaveLength(1);
  });

  it('reopening a few minutes apart now counts as separate sessions (ADR-26)', () => {
    // 0, 8, 16 min -> each gap > 5 min -> three genuine visits.
    expect(clusterOpenSessions([at(0), at(8), at(16)])).toHaveLength(3);
  });

  it('is order-independent (sorts input first)', () => {
    expect(clusterOpenSessions([at(20), at(0), at(2)])).toHaveLength(2);
  });
});

describe('detectSyncPattern', () => {
  it('does not flag fewer than 3 opens', () => {
    expect(detectSyncPattern([at(0), at(45)]).suspect).toBe(false);
  });

  it('flags clockwork-regular opens wider than the session gap', () => {
    const result = detectSyncPattern([at(0), at(45), at(90), at(135)]);
    expect(result.suspect).toBe(true);
    expect(result.reason).toMatch(/regular/i);
  });

  it('does NOT flag regular opens that are all within the session gap (one sitting, not a polling cadence)', () => {
    // 2-min intervals, comfortably inside the 5-min session gap.
    expect(detectSyncPattern([at(0), at(2), at(4), at(6)]).suspect).toBe(false);
  });

  it('does NOT flag irregular, human-looking intervals', () => {
    expect(detectSyncPattern([at(0), at(40), at(200), at(205)]).suspect).toBe(false);
  });
});
