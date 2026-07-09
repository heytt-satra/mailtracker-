import type { BeaconPosition, DepthReached, Verdict } from '@mailtrack/shared';

export interface DepthEvent {
  verdict: Verdict;
  beaconPosition: BeaconPosition | null;
}

const RANK: Record<BeaconPosition, number> = { top: 0, mid: 1, bottom: 2 };

/**
 * Highest depth beacon position with a verified_open verdict. Pure and
 * testable in isolation — see PLAN.md ADR-19. Deliberately ignores
 * 'top'-only history (returns null): the ordinary single pixel already
 * proves an open via ReadConfidence, so reporting 'top' here would just be
 * a second name for information already shown elsewhere. Only mid/bottom —
 * beacons that ONLY exist on messages long enough to plausibly hit Gmail's
 * clip threshold — represent genuinely new information.
 */
export function computeDepthReached(events: DepthEvent[]): DepthReached {
  let best: BeaconPosition | null = null;
  for (const event of events) {
    if (event.verdict !== 'verified_open' || !event.beaconPosition) continue;
    if (best === null || RANK[event.beaconPosition] > RANK[best]) {
      best = event.beaconPosition;
    }
  }
  return best === 'mid' || best === 'bottom' ? best : null;
}
