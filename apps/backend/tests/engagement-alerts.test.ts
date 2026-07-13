import { describe, expect, it } from 'vitest';
import { HOT_CONVERSATION_WINDOW_MS, REVIVAL_DORMANT_THRESHOLD_MS, isHotConversation, isRevival } from '../src/engagement-alerts';

const base = new Date('2026-01-01T00:00:00.000Z').getTime();
const at = (msFromBase: number) => new Date(base + msFromBase).toISOString();

describe('isHotConversation', () => {
  it('is false with fewer than 3 opens', () => {
    expect(isHotConversation([at(0), at(1000)])).toBe(false);
  });

  it('is true when 3+ opens all land within the window of the latest', () => {
    const opens = [at(0), at(10 * 60 * 1000), at(20 * 60 * 1000)]; // 0, 10min, 20min — all within 1h of the latest
    expect(isHotConversation(opens)).toBe(true);
  });

  it('is false when only 2 of the opens are within the window of the latest', () => {
    const opens = [at(0), at(5 * HOT_CONVERSATION_WINDOW_MS), at(5 * HOT_CONVERSATION_WINDOW_MS + 1000)];
    expect(isHotConversation(opens)).toBe(false);
  });

  it('does not require the list to be pre-sorted at the call site — caller is expected to sort, but a sorted 3-cluster still triggers', () => {
    const opens = [at(0), at(30 * 60 * 1000), at(59 * 60 * 1000)];
    expect(isHotConversation(opens)).toBe(true);
  });
});

describe('isRevival', () => {
  it('is false with fewer than 2 opens', () => {
    expect(isRevival([at(0)])).toBe(false);
  });

  it('is false when the gap since the previous open is under the dormant threshold', () => {
    expect(isRevival([at(0), at(REVIVAL_DORMANT_THRESHOLD_MS - 1000)])).toBe(false);
  });

  it('is true when the gap since the previous open meets the dormant threshold', () => {
    expect(isRevival([at(0), at(REVIVAL_DORMANT_THRESHOLD_MS)])).toBe(true);
  });

  it('only considers the gap to the immediately preceding open, not the earliest one', () => {
    const opens = [at(0), at(REVIVAL_DORMANT_THRESHOLD_MS), at(REVIVAL_DORMANT_THRESHOLD_MS + 60_000)];
    // latest open is only 60s after the previous one — not a revival, even though it's far from the first open
    expect(isRevival(opens)).toBe(false);
  });
});
