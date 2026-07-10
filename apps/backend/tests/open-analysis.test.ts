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

  it('opens within the 30-min gap collapse into one session', () => {
    expect(clusterOpenSessions([at(0), at(10), at(25)])).toHaveLength(1);
  });

  it('an open past the 30-min gap starts a new session', () => {
    const sessions = clusterOpenSessions([at(0), at(10), at(50)]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toHaveLength(2);
    expect(sessions[1]).toHaveLength(1);
  });

  it('the real-world example clusters to 3 sessions', () => {
    // 00:29, 00:44, 00:56, 01:58, 08:55 -> gaps 15,12,62,417 min
    expect(clusterOpenSessions([at(29), at(44), at(56), at(118), at(535)])).toHaveLength(3);
  });

  it('is order-independent (sorts input first)', () => {
    expect(clusterOpenSessions([at(50), at(0), at(10)])).toHaveLength(2);
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
    expect(detectSyncPattern([at(0), at(5), at(10), at(15)]).suspect).toBe(false);
  });

  it('does NOT flag irregular, human-looking intervals', () => {
    expect(detectSyncPattern([at(0), at(40), at(200), at(205)]).suspect).toBe(false);
  });
});
