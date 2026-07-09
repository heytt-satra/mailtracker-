import type { SupabaseClient } from '@supabase/supabase-js';
import { getUnclassifiedRawEvents } from '../db/client';
import { classifyAndApplyOne } from './classify-and-apply';

/**
 * Runs on the wrangler.toml cron trigger (every minute). ADR-15: as of
 * inline classification (pixel.ts/click.ts calling classifyAndApplyOne
 * directly right after logging), this sweep is no longer the primary path —
 * it's a fallback safety net for events that, for whatever reason, didn't
 * get classified inline (e.g. a Worker instance recycled mid-execution
 * before its waitUntil finished — rare, but `waitUntil` has no absolute
 * completion guarantee). Kept because "eventually consistent" is a much
 * better failure mode than "silently stuck unclassified forever."
 */
export async function runClassifierSweep(db: SupabaseClient): Promise<{ processed: number; escalated: number }> {
  const pending = await getUnclassifiedRawEvents(db);
  let escalated = 0;

  for (const event of pending) {
    const result = await classifyAndApplyOne(db, event);
    if (result?.escalated) escalated++;
  }

  return { processed: pending.length, escalated };
}
