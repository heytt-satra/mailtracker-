import type { ReadConfidence } from '@mailtrack/shared';

export interface ReadConfidenceChipDescriptor {
  label: string;
  color: string;
}

/**
 * Pure mapping from ReadConfidence to display text/color, mirroring
 * status-chip.ts. `null` (no signal yet) renders nothing — a message that
 * hasn't been opened has nothing to say about read confidence, which is
 * different from `not_verifiable` (activity seen but unconfirmed).
 */
export function describeReadConfidence(confidence: ReadConfidence | null): ReadConfidenceChipDescriptor | null {
  switch (confidence) {
    case 'read':
      return { label: 'Read', color: '#188038' };
    case 'likely_read':
      return { label: 'Likely read', color: '#1a73e8' };
    case 'glanced':
      // ADR-29: no longer produced by computeReadSignal (a single verified
      // open is now 'likely_read' — see read-signal.ts). Kept in the type
      // and this switch for exhaustiveness/forward-compat, not currently reachable.
      return { label: 'Glanced', color: '#9aa0a6' };
    case 'not_verifiable':
      return { label: 'Not verifiable', color: '#9aa0a6' };
    case null:
      return null;
  }
}
