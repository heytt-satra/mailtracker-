import { describe, expect, it } from 'vitest';
import { computeDepthReached } from '../src/depth-signal';

describe('computeDepthReached', () => {
  it('returns null for an empty history', () => {
    expect(computeDepthReached([])).toBeNull();
  });

  it('returns null when only the ordinary top pixel has been verified — no new depth information', () => {
    expect(computeDepthReached([{ verdict: 'verified_open', beaconPosition: 'top' }])).toBeNull();
  });

  it('returns null when a beacon fetch happened but was classified machine_suspect, not verified', () => {
    expect(computeDepthReached([{ verdict: 'machine_suspect', beaconPosition: 'bottom' }])).toBeNull();
  });

  it('reports mid when the mid beacon is verified', () => {
    expect(
      computeDepthReached([
        { verdict: 'verified_open', beaconPosition: 'top' },
        { verdict: 'verified_open', beaconPosition: 'mid' },
      ]),
    ).toBe('mid');
  });

  it('reports bottom (the deepest) even when mid also fired', () => {
    expect(
      computeDepthReached([
        { verdict: 'verified_open', beaconPosition: 'top' },
        { verdict: 'verified_open', beaconPosition: 'mid' },
        { verdict: 'verified_open', beaconPosition: 'bottom' },
      ]),
    ).toBe('bottom');
  });

  it('is order-independent — the deepest verified position wins regardless of arrival order', () => {
    expect(
      computeDepthReached([
        { verdict: 'verified_open', beaconPosition: 'bottom' },
        { verdict: 'verified_open', beaconPosition: 'top' },
      ]),
    ).toBe('bottom');
  });

  it('ignores link_click and not_verifiable verdicts entirely', () => {
    expect(
      computeDepthReached([
        { verdict: 'verified_click', beaconPosition: 'bottom' },
        { verdict: 'not_verifiable', beaconPosition: 'bottom' },
      ]),
    ).toBeNull();
  });
});
