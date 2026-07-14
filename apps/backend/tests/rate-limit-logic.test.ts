import { describe, expect, it } from 'vitest';
import { decideRateLimit, type RateLimitConfig, type RateLimitState } from '../src/rate-limit-logic';

const FLAT: RateLimitConfig = { limit: 3, windowMs: 60_000, backoff: false };
const BACKOFF: RateLimitConfig = { limit: 3, windowMs: 60_000, backoff: true };

describe('decideRateLimit — allowing requests under the limit', () => {
  it('allows the first request with no prior state', () => {
    const decision = decideRateLimit(null, FLAT, 1000);
    expect(decision.allowed).toBe(true);
    expect(decision.retryAfterSeconds).toBe(0);
    expect(decision.state.countInWindow).toBe(1);
  });

  it('allows requests up to and including the limit within one window', () => {
    let state: RateLimitState | null = null;
    let nowMs = 0;
    for (let i = 0; i < FLAT.limit; i++) {
      const decision = decideRateLimit(state, FLAT, nowMs);
      expect(decision.allowed).toBe(true);
      state = decision.state;
      nowMs += 1000;
    }
  });
});

describe('decideRateLimit — flat (non-backoff) mode', () => {
  it('blocks the request immediately after the limit is exceeded', () => {
    let state: RateLimitState | null = null;
    let nowMs = 0;
    for (let i = 0; i < FLAT.limit; i++) {
      state = decideRateLimit(state, FLAT, nowMs).state;
      nowMs += 100;
    }
    const decision = decideRateLimit(state, FLAT, nowMs);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('unblocks once the window has fully elapsed, without any backoff extension', () => {
    let state: RateLimitState | null = null;
    let nowMs = 0;
    for (let i = 0; i <= FLAT.limit; i++) {
      state = decideRateLimit(state, FLAT, nowMs).state;
    }
    // Jump past the window boundary.
    const decision = decideRateLimit(state, FLAT, FLAT.windowMs + 1);
    expect(decision.allowed).toBe(true);
  });
});

describe('decideRateLimit — exponential backoff mode', () => {
  it('the wait grows on each successive violation within the blocked period', () => {
    let state: RateLimitState | null = null;
    let nowMs = 0;
    for (let i = 0; i < BACKOFF.limit; i++) {
      state = decideRateLimit(state, BACKOFF, nowMs).state;
    }
    const firstViolation = decideRateLimit(state, BACKOFF, nowMs);
    expect(firstViolation.allowed).toBe(false);
    const firstWait = firstViolation.retryAfterSeconds;

    // Retry immediately (still blocked) — same block, not a new escalation.
    const stillBlocked = decideRateLimit(firstViolation.state, BACKOFF, nowMs + 10);
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.retryAfterSeconds).toBeLessThanOrEqual(firstWait);

    // Wait out the first block, then violate again — the second block should be longer.
    const afterFirstBlock = decideRateLimit(firstViolation.state, BACKOFF, firstViolation.state.blockedUntilMs + 1);
    // afterFirstBlock is itself an "allowed" request (starts a fresh window) — consume up to the limit again, then violate.
    let s = afterFirstBlock.state;
    let t = firstViolation.state.blockedUntilMs + 1;
    for (let i = 1; i < BACKOFF.limit; i++) {
      t += 100;
      s = decideRateLimit(s, BACKOFF, t).state;
    }
    const secondViolation = decideRateLimit(s, BACKOFF, t + 100);
    expect(secondViolation.allowed).toBe(false);
    expect(secondViolation.retryAfterSeconds).toBeGreaterThan(firstWait);
  });

  it('caps the backoff duration at maxBackoffMs regardless of violation count', () => {
    const config: RateLimitConfig = { limit: 1, windowMs: 1000, backoff: true, maxBackoffMs: 5000 };
    let state: RateLimitState = { windowStartMs: 0, countInWindow: 0, violationCount: 20, blockedUntilMs: 0 };
    const decision = decideRateLimit(state, config, 0);
    expect(decision.state.blockedUntilMs).toBeLessThanOrEqual(5000);
  });

  it('decays the violation streak after a clean window rather than resetting it instantly', () => {
    const config: RateLimitConfig = { limit: 1, windowMs: 1000, backoff: true };
    const highViolationState: RateLimitState = { windowStartMs: 0, countInWindow: 1, violationCount: 5, blockedUntilMs: 0 };
    // Roll past the window with no new request in between (simulated by calling once, well past window end).
    const decision = decideRateLimit(highViolationState, config, 5000);
    expect(decision.state.violationCount).toBe(4); // decayed by exactly 1, not reset to 0
  });
});

describe('decideRateLimit — an active block rejects without consuming a fresh slot', () => {
  it('repeated requests during an active block keep the same blockedUntilMs (no slot consumption, no re-escalation)', () => {
    const blockedState: RateLimitState = { windowStartMs: 0, countInWindow: 5, violationCount: 2, blockedUntilMs: 10_000 };
    const decision = decideRateLimit(blockedState, BACKOFF, 5000);
    expect(decision.allowed).toBe(false);
    expect(decision.state).toEqual(blockedState); // untouched — still blocked, same violation count
  });
});
