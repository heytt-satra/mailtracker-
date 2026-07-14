import { DurableObject } from 'cloudflare:workers';
import { decideRateLimit, type RateLimitConfig, type RateLimitDecision, type RateLimitState } from './rate-limit-logic';

/**
 * Thin stateful shell around decideRateLimit (rate-limit-logic.ts) — all the
 * actual decision logic lives there and is unit-tested directly; this class
 * only does the I/O: read persisted state, call the pure function, persist
 * the result. One DO instance per rate-limit key (an IP, a user id, an
 * "ip:<x>"/"account:<y>" pair for auth) — Cloudflare routes all requests for
 * the same key to the same instance, giving strongly-consistent counters
 * without a shared KV/DB round-trip.
 *
 * Storage cleanup: an alarm is (re)scheduled a few windows past the current
 * block/window on every write, and deletes all storage when it fires. A key
 * that goes quiet naturally gets its instance emptied out rather than
 * holding onto rate-limit state forever.
 */
export class RateLimiterDO extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const config = await request.json<RateLimitConfig>();
    const prev = (await this.ctx.storage.get<RateLimitState>('state')) ?? null;
    const decision: RateLimitDecision = decideRateLimit(prev, config, Date.now());
    await this.ctx.storage.put('state', decision.state);

    // Schedule cleanup comfortably past whatever this decision's furthest
    // future timestamp is (the active block, if any, else the window end),
    // so storage doesn't accumulate for keys that stop being seen.
    const cleanupAtMs = Math.max(decision.state.blockedUntilMs, decision.state.windowStartMs + config.windowMs) + config.windowMs;
    await this.ctx.storage.setAlarm(cleanupAtMs);

    return Response.json({ allowed: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
