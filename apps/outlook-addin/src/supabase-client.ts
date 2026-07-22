import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

/**
 * ADR-61 (Outlook add-in, C2). Copied from apps/extension/src/supabase-client.ts
 * — identical, no chrome dependency. `persistSession: false` for the same
 * reason as the extension: MailTrack's own API key (see storage.ts) is the
 * long-lived credential here, not a Supabase session.
 */
export function getSupabaseAuthClient(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}
