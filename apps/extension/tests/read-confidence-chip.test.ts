import { describe, expect, it } from 'vitest';
import { describeReadConfidence } from '../src/read-confidence-chip';

describe('describeReadConfidence', () => {
  it('returns null for no signal — a message that has not been opened has nothing to claim', () => {
    expect(describeReadConfidence(null)).toBeNull();
  });

  it('labels not_verifiable distinctly from a positive read signal', () => {
    const chip = describeReadConfidence('not_verifiable');
    expect(chip?.label).toMatch(/not verifiable/i);
  });

  it('produces a distinct color for each non-null confidence level', () => {
    const levels = ['read', 'likely_read', 'glanced', 'not_verifiable'] as const;
    const colors = new Set(levels.map((l) => describeReadConfidence(l)?.color));
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });
});
