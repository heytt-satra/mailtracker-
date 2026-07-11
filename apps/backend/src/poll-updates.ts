import type { PollUpdate } from '@mailtrack/shared';

/**
 * ADR-30. Merges two independent query results — status-ladder changes and
 * bounce detections — into one notification-worthy update list. Pure and
 * testable in isolation: no DB access, so the "which events actually
 * produce a notification" logic can be verified without mocking Supabase.
 *
 * Bounces live in a separate `bounce_detected_at` column (ADR-20 — bounce
 * is orthogonal to the status ladder, not a MessageStatus value), so they
 * can never be caught by a single `status IN (...)` query and need their
 * own row set, merged here.
 */
export function buildPollUpdates(
  statusRows: { id: string; status: string; status_updated_at: string; recipient: string | null; subject: string | null }[],
  bounceRows: { id: string; bounce_detected_at: string; recipient: string | null; subject: string | null }[],
): PollUpdate[] {
  const updates: PollUpdate[] = [];

  for (const row of statusRows) {
    if (row.status === 'opened' || row.status === 'clicked' || row.status === 'replied') {
      updates.push({ msgId: row.id, event: row.status, occurredAt: row.status_updated_at, recipient: row.recipient, subject: row.subject });
    }
  }
  for (const row of bounceRows) {
    updates.push({ msgId: row.id, event: 'bounced', occurredAt: row.bounce_detected_at, recipient: row.recipient, subject: row.subject });
  }

  return updates;
}
