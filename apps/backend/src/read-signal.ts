import type { ReadConfidence, Verdict } from '@mailtrack/shared';
import { clusterOpenSessions, detectSyncPattern } from './open-analysis';

export interface VerdictEvent {
  verdict: Verdict;
  createdAt: string;
}

export interface ReadSignal {
  readConfidence: ReadConfidence | null;
  minEngagedSeconds: number | null;
  readEvidence: string | null;
  /**
   * ADR-22. Distinct viewing occasions (rapid re-fetches collapsed), not raw
   * open count — the number a human means by "how many times did they open
   * it". Null when there were no verified opens.
   */
  sessionCount: number | null;
  /** ADR-22. True when repeat opens look like an automated mail sync (clockwork-regular) rather than a human returning. */
  syncSuspect: boolean;
}

const NO_SIGNAL: ReadSignal = { readConfidence: null, minEngagedSeconds: null, readEvidence: null, sessionCount: null, syncSuspect: false };

/**
 * Turns a message's ordered verdict history into a Read Confidence verdict.
 * Pure and testable in isolation — no DB/network access. See
 * docs/read-detection-plan.md Track A/E and PLAN.md ADR-18.
 *
 * Deliberately does NOT estimate a true "seconds open" figure: Cloudflare
 * Workers cannot detect stream disconnection (confirmed empirically), so
 * the only duration we can prove is a lower bound between two independently
 * verified timestamps (an open followed by a later click). Everything else
 * is reported as a discrete signal (opened once / opened repeatedly /
 * clicked / machine-only), never a fabricated number.
 */
export function computeReadSignal(events: VerdictEvent[]): ReadSignal {
  const opens = events
    .filter((e) => e.verdict === 'verified_open')
    .map((e) => e.createdAt)
    .sort();
  const clicks = events
    .filter((e) => e.verdict === 'verified_click')
    .map((e) => e.createdAt)
    .sort();
  const hadMachineOnlyActivity = events.some((e) => e.verdict === 'machine_suspect' || e.verdict === 'not_verifiable');

  // ADR-22: honest "how many times did they open it" = distinct sessions, not
  // raw fetches. Sync detection runs over the raw opens (its own regularity
  // math), independent of clustering.
  const sessions = clusterOpenSessions(opens);
  const sessionCount = opens.length > 0 ? sessions.length : null;
  const sync = detectSyncPattern(opens);
  const syncCaveat = sync.suspect ? ` (note: ${sync.reason})` : '';

  if (clicks.length > 0) {
    const firstClick = clicks[0]!;
    const precedingOpens = opens.filter((o) => o <= firstClick);
    const anchorOpen = precedingOpens.length > 0 ? precedingOpens[precedingOpens.length - 1]! : null;

    if (anchorOpen) {
      const minEngagedSeconds = Math.max(0, Math.round((new Date(firstClick).getTime() - new Date(anchorOpen).getTime()) / 1000));
      return {
        readConfidence: 'read',
        minEngagedSeconds,
        readEvidence:
          minEngagedSeconds > 0
            ? `Opened, then clicked a tracked link ${minEngagedSeconds}s later — engaged for at least ${minEngagedSeconds}s`
            : `Opened and clicked a tracked link — genuine engagement confirmed`,
        sessionCount,
        syncSuspect: sync.suspect,
      };
    }
    // A click was verified without a preceding verified open in our data (edge case
    // in the classifier ladder) — still real evidence of engagement, just no bracket to report.
    return {
      readConfidence: 'read',
      minEngagedSeconds: null,
      readEvidence: `Clicked a tracked link — genuine engagement confirmed`,
      sessionCount,
      syncSuspect: sync.suspect,
    };
  }

  // ADR-28 (reverts ADR-22's session-based tiering): the confidence tier is
  // driven by the count of VERIFIED opens, not clustered sessions. Gmail's
  // image proxy fires several fetches for a single genuine open, so 2+
  // verified opens means the message was actually rendered and viewed —
  // "likely read". A lone verified fetch is a glance. Session count is still
  // computed and surfaced for context (and syncSuspect as a caveat), but it
  // no longer downgrades the verdict — which had made a real, actively-read
  // open show as "glanced", the exact regression the user reported.
  if (opens.length >= 2) {
    const sessionNote = sessionCount && sessionCount >= 2 ? ` across ${sessionCount} separate sessions` : '';
    return {
      readConfidence: 'likely_read',
      minEngagedSeconds: null,
      readEvidence: `Opened and rendered ${opens.length} times${sessionNote} — genuinely viewed by a human, consistent with reading${syncCaveat}`,
      sessionCount,
      syncSuspect: sync.suspect,
    };
  }

  if (opens.length === 1) {
    return {
      readConfidence: 'glanced',
      minEngagedSeconds: null,
      readEvidence: `Opened once — a brief view; not enough repeat rendering to confirm sustained reading`,
      sessionCount,
      syncSuspect: sync.suspect,
    };
  }

  if (hadMachineOnlyActivity) {
    return {
      readConfidence: 'not_verifiable',
      minEngagedSeconds: null,
      readEvidence: `Only automated activity detected (e.g. prefetch or a security scanner) — no verified human open`,
      sessionCount: null,
      syncSuspect: false,
    };
  }

  return NO_SIGNAL;
}
