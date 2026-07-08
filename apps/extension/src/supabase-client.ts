import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

/** Lazily created so a missing/placeholder config doesn't throw at module load time — only when auth is actually attempted. */
export function getSupabaseAuthClient(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false }, // MailTrack's own API key is the long-lived credential; no need to persist a Supabase session too
    });
  }
  return client;
}
