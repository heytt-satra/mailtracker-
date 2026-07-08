import type { MessageStatus } from '@mailtrack/shared';

export interface StatusChipDescriptor {
  tooltip: string;
  color: string;
}

/**
 * Pure mapping from status to display text/color — no InboxSDK or DOM
 * dependency, so it's unit-testable in isolation (tests/status-chip.test.ts).
 * The tooltip text is deliberately explicit about WHY a status is what it is
 * for `not_verifiable`, per FR7: never let a status look like a blank/bug.
 */
export function describeStatus(status: MessageStatus): StatusChipDescriptor {
  switch (status) {
    case 'sent':
      return { tooltip: 'MailTrack: sent, awaiting delivery confirmation', color: '#9aa0a6' };
    case 'delivered':
      return { tooltip: 'MailTrack: delivered, not yet verified as opened', color: '#9aa0a6' };
    case 'opened':
      return { tooltip: 'MailTrack: opened (verified — a human read this)', color: '#1a73e8' };
    case 'clicked':
      return { tooltip: 'MailTrack: link clicked (verified)', color: '#188038' };
    case 'not_verifiable':
      return { tooltip: "MailTrack: this recipient's platform blocks open verification (e.g. Apple Mail Privacy Protection) — not a bug", color: '#9aa0a6' };
  }
}

/** 12x12 filled circle in the status color. No external asset needed, no watermark. */
export function statusIconDataUrl(status: MessageStatus): string {
  const { color } = describeStatus(status);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><circle cx="6" cy="6" r="5" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
