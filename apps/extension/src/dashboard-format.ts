/** Pure formatting helpers for the dashboard, kept separate from DOM wiring so they're unit-testable. */

export function formatSentAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function truncateSubject(subject: string | null, maxLength = 80): string {
  if (!subject) return '(no subject)';
  return subject.length > maxLength ? `${subject.slice(0, maxLength - 1)}…` : subject;
}
