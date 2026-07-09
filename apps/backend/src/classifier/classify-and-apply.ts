import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClassificationInput, EventKind, IntelCategory, Verdict } from '@mailtrack/shared';
import { getAsnIntel, getMessageById, getPriorFetchContext, insertVerdict, markRawEventClassified, updateMessageStatus } from '../db/client';
import { classifyEvent } from './rules';
import { nextStatus } from './escalation';

export interface ClassifiableEvent {
  id: string;
  message_id: string;
  kind: EventKind;
  occurred_at: string;
  user_agent: string | null;
  asn: number | null;
  ip_category: IntelCategory | null;
  fetch_sequence_ms: number;
}

/**
 * Classifies one raw event and applies the result: writes a verdict,
 * advances the message's status through the escalate-only ladder if
 * warranted, and marks the event classified. Extracted from sweep.ts so
 * pixel.ts/click.ts can call it directly — see ADR-15 for why: the original
 * once-per-minute cron sweep meant a real open/click could take up to 60
 * seconds to show up anywhere, which a real user correctly flagged as
 * broken. Returns null if the message was deleted (delete-my-data) after
 * the event was logged, in which case the event is just marked classified
 * and dropped.
 */
export async function classifyAndApplyOne(
  db: SupabaseClient,
  event: ClassifiableEvent,
): Promise<{ verdict: Verdict; escalated: boolean } | null> {
  const message = await getMessageById(db, event.message_id);
  if (!message) {
    await markRawEventClassified(db, event.id);
    return null;
  }

  const asnIntel = event.asn !== null ? await getAsnIntel(db, event.asn) : null;
  const { isFirstFetch, burstFetchCount } =
    event.kind === 'pixel_fetch'
      ? await getPriorFetchContext(db, event.message_id, event.id, event.occurred_at)
      : { isFirstFetch: false, burstFetchCount: 1 };

  const input: ClassificationInput = {
    event: {
      messageId: event.message_id,
      kind: event.kind,
      occurredAtMs: new Date(event.occurred_at).getTime(),
      userAgent: event.user_agent,
      ip: '', // not needed by classifyEvent; IP is only used upstream for ASN/range resolution
      headers: {},
      fetchSequenceMs: event.fetch_sequence_ms,
    },
    asnIntel,
    ipCategory: event.ip_category,
    burstFetchCount,
    isFirstFetch,
  };

  const result = classifyEvent(input);
  await insertVerdict(db, { messageId: event.message_id, rawEventId: event.id, verdict: result.verdict, reason: result.reason });

  const updatedStatus = nextStatus(message.status, result.verdict);
  const escalated = updatedStatus !== message.status;
  if (escalated) {
    await updateMessageStatus(db, message.id, updatedStatus);
  }

  await markRawEventClassified(db, event.id);
  return { verdict: result.verdict, escalated };
}
