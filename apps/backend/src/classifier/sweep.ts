import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClassificationInput } from '@mailtrack/shared';
import {
  getAsnIntel,
  getMessageById,
  getPriorFetchContext,
  getUnclassifiedRawEvents,
  insertVerdict,
  markRawEventClassified,
  updateMessageStatus,
} from '../db/client';
import { classifyEvent } from './rules';
import { nextStatus } from './escalation';

/**
 * Runs on the wrangler.toml cron trigger (every minute). Classification
 * never runs inline on the pixel/click hot path (ADR-1) — this is where it
 * actually happens, out of band, so a slow classifier can never slow down
 * an email send or an image fetch.
 */
export async function runClassifierSweep(db: SupabaseClient): Promise<{ processed: number; escalated: number }> {
  const pending = await getUnclassifiedRawEvents(db);
  let escalated = 0;

  for (const event of pending) {
    const message = await getMessageById(db, event.message_id);
    if (!message) {
      // Message was deleted (delete-my-data) after the event was logged; drop it.
      await markRawEventClassified(db, event.id);
      continue;
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
    if (updatedStatus !== message.status) {
      await updateMessageStatus(db, message.id, updatedStatus);
      escalated++;
    }

    await markRawEventClassified(db, event.id);
  }

  return { processed: pending.length, escalated };
}
