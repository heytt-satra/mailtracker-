/**
 * Pure rate-limit decision logic — no DO/storage/network. Same discipline
 * as classifier/rules.ts and reports.ts: keep anything with real branching
 * logic testable without spinning up Cloudflare's runtime. The stateful
 * wrapper (rate-limiter-do.ts) is a thin shell around this function: read
 * persisted state, call decideRateLimit, persist the returned state.
 */

export interface RateLimitConfig {
  /** Max requests allowed within one window. */
  limit: number;
  windowMs: number;
  /**
   * When true, exceeding the limit blocks for an exponentially growing
   * duration on each successive violation (capped at maxBackoffMs) instead
   * of a flat "wait until the window resets" — appropriate for auth routes,
   * where a hard fixed-window lockout is trivially waited out by an
   * attacker, but escalating backoff makes repeated guessing increasingly
   * expensive.
   */
  backoff: boolean;
  /** Only meaningful when backoff is true. Defaults to 15 minutes. */
  maxBackoffMs?: number;
}

export interface RateLimitState {
  windowStartMs: number;
  countInWindow: number;
  /** Consecutive violations, used to compute the backoff duration. Decays (not resets) on a clean window, so one quiet minute after a burst doesn't fully forgive a sustained attacker. */
  violationCount: number;
  /** 0 when not currently serving a backoff block. */
  blockedUntilMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** 0 when allowed. */
  retryAfterSeconds: number;
  /** Caller persists this as the new state for the next call. */
  state: RateLimitState;
}

const DEFAULT_MAX_BACKOFF_MS = 15 * 60_000;

function freshState(nowMs: number): RateLimitState {
  return { windowStartMs: nowMs, countInWindow: 0, violationCount: 0, blockedUntilMs: 0 };
}

export function decideRateLimit(prev: RateLimitState | null, config: RateLimitConfig, nowMs: number): RateLimitDecision {
  let state = prev ?? freshState(nowMs);

  // Still serving an active backoff block from a prior violation — every
  // request during this window is rejected without consuming another slot
  // (consuming one would let a caller "pay down" the block faster by
  // retrying more, the opposite of the intended deterrent).
  if (state.blockedUntilMs > nowMs) {
    return { allowed: false, retryAfterSeconds: Math.ceil((state.blockedUntilMs - nowMs) / 1000), state };
  }

  if (nowMs - state.windowStartMs >= config.windowMs) {
    // Window rolled over. Only decay the violation streak if the window
    // that just ended was itself clean (never exceeded the limit) — the
    // window in which a block was actively being served must not decay
    // when it finally rolls over, or a caller could escalate, wait out
    // exactly one block, and reset straight back to zero on the very next
    // violation instead of the streak actually growing.
    const priorWindowHadViolation = state.countInWindow > config.limit;
    state = {
      windowStartMs: nowMs,
      countInWindow: 0,
      violationCount: priorWindowHadViolation ? state.violationCount : Math.max(0, state.violationCount - 1),
      blockedUntilMs: 0,
    };
  }

  const countInWindow = state.countInWindow + 1;

  if (countInWindow > config.limit) {
    const violationCount = state.violationCount + 1;
    const maxBackoffMs = config.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    // Non-backoff mode: blocked only until the current window rolls over
    // (the pre-existing flat-limit behavior). Backoff mode: each additional
    // violation doubles the wait, capped at maxBackoffMs.
    const backoffMs = config.backoff ? Math.min(maxBackoffMs, config.windowMs * 2 ** violationCount) : Math.max(0, config.windowMs - (nowMs - state.windowStartMs));
    const blockedUntilMs = nowMs + backoffMs;
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(backoffMs / 1000),
      state: { windowStartMs: state.windowStartMs, countInWindow, violationCount, blockedUntilMs },
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    state: { windowStartMs: state.windowStartMs, countInWindow, violationCount: state.violationCount, blockedUntilMs: 0 },
  };
}
