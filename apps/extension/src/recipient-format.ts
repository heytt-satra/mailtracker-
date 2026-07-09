import type { Contact } from './inboxsdk-types';

/**
 * Formats the "To" recipients into a single display/storage string —
 * plaintext, the sender's own compose data shown back to the same sender,
 * same privacy reasoning as messages.subject (see db/migrations/0001_init.sql).
 * Built because multiple tracked emails can share an identical subject line,
 * making the recipient the only reliable way to tell them apart at a glance.
 */
export function formatRecipients(recipients: Contact[], maxShown = 3): string {
  if (recipients.length === 0) return '';
  const emails = recipients.map((r) => r.emailAddress);
  if (emails.length <= maxShown) return emails.join(', ');
  const shown = emails.slice(0, maxShown).join(', ');
  return `${shown} +${emails.length - maxShown} more`;
}
