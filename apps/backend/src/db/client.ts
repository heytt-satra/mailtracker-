import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AsnIntel, EventKind, IntelCategory, MessageStatus, Verdict } from '@mailtrack/shared';
import type { Env } from '../types';

export function getSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Anon-key client, used ONLY to validate a caller-supplied Supabase access
 * token via `.auth.getUser(jwt)` — never for privileged table access (that's
 * what the service-key client above is for). Confirmed real API:
 * `getUser(jwt?: string): Promise<{data: {user}, error}>` validates the
 * given JWT server-side and returns the Supabase Auth user it belongs to.
 */
export function getSupabaseAnon(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

export interface UserRow {
  id: string;
}

export async function getUserByApiKeyHash(db: SupabaseClient, apiKeyHash: string): Promise<UserRow | null> {
  const { data, error } = await db.from('users').select('id').eq('api_key_hash', apiKeyHash).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Called by POST /v1/auth/provision. `id` here is the Supabase Auth user's
 * own id (the "profiles" pattern — see db/migrations/0001_init.sql). Each
 * call rotates the API key: simplest self-serve recovery story for v1 (no
 * separate "forgot my key" flow needed) at the cost of invalidating any
 * previously-issued key for the account, which is an acceptable trade for a
 * key meant to live in exactly one browser's extension storage.
 */
export async function upsertUserApiKey(
  db: SupabaseClient,
  params: { authUserId: string; email: string | null; apiKeyHash: string },
): Promise<void> {
  const { error } = await db
    .from('users')
    .upsert({ id: params.authUserId, email: params.email, api_key_hash: params.apiKeyHash }, { onConflict: 'id' });
  if (error) throw error;
}

export interface MessageRow {
  id: string;
  user_id: string;
  pixel_token: string;
  sent_at: string;
  status: MessageStatus;
  status_updated_at: string;
}

const MESSAGE_COLUMNS = 'id, user_id, pixel_token, sent_at, status, status_updated_at';

export async function insertMessage(
  db: SupabaseClient,
  params: { userId: string; gmailMessageId?: string; subject?: string; pixelToken: string },
): Promise<MessageRow> {
  const { data, error } = await db
    .from('messages')
    .insert({
      user_id: params.userId,
      gmail_message_id: params.gmailMessageId ?? null,
      subject: params.subject ?? null,
      pixel_token: params.pixelToken,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export interface MessageSummaryRow {
  id: string;
  subject: string | null;
  status: MessageStatus;
  sent_at: string;
}

const LIST_PAGE_SIZE = 50;

/** Paginated, newest-first — backs GET /v1/messages (dashboard message list, M5). */
export async function listMessagesForUser(
  db: SupabaseClient,
  userId: string,
  offset: number,
): Promise<{ rows: MessageSummaryRow[]; nextOffset: number | null }> {
  const { data, error } = await db
    .from('messages')
    .select('id, subject, status, sent_at')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .range(offset, offset + LIST_PAGE_SIZE - 1);
  if (error) throw error;
  const rows = data ?? [];
  return { rows, nextOffset: rows.length === LIST_PAGE_SIZE ? offset + LIST_PAGE_SIZE : null };
}

export async function insertLinkTokens(
  db: SupabaseClient,
  messageId: string,
  links: { token: string; originalUrl: string }[],
): Promise<void> {
  if (links.length === 0) return;
  const { error } = await db
    .from('link_tokens')
    .insert(links.map((l) => ({ message_id: messageId, token: l.token, original_url: l.originalUrl })));
  if (error) throw error;
}

export async function getMessageByPixelToken(db: SupabaseClient, pixelToken: string): Promise<MessageRow | null> {
  const { data, error } = await db
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('pixel_token', pixelToken)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLinkToken(
  db: SupabaseClient,
  token: string,
): Promise<{ messageId: string; originalUrl: string; sentAt: string; status: MessageStatus } | null> {
  const { data, error } = await db
    .from('link_tokens')
    .select('message_id, original_url, messages(sent_at, status)')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const message = Array.isArray(data.messages) ? data.messages[0] : data.messages;
  return {
    messageId: data.message_id,
    originalUrl: data.original_url,
    sentAt: message?.sent_at ?? new Date().toISOString(),
    status: (message?.status as MessageStatus) ?? 'sent',
  };
}

export async function insertRawEvent(
  db: SupabaseClient,
  params: {
    messageId: string;
    kind: EventKind;
    userAgent: string | null;
    ipHash: string;
    ipCategory: IntelCategory | null;
    asn: number | null;
    headers: Record<string, string>;
    fetchSequenceMs: number;
  },
): Promise<{ id: string }> {
  const { data, error } = await db
    .from('raw_events')
    .insert({
      message_id: params.messageId,
      kind: params.kind,
      user_agent: params.userAgent,
      ip_hash: params.ipHash,
      ip_category: params.ipCategory,
      asn: params.asn,
      headers: params.headers,
      fetch_sequence_ms: params.fetchSequenceMs,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

/** Resolves an IP against the ip_ranges table via the classify_ip_category() Postgres function (ADR-8). */
export async function classifyIpCategory(db: SupabaseClient, ip: string): Promise<IntelCategory | null> {
  if (ip === 'unknown') return null;
  const { data, error } = await db.rpc('classify_ip_category', { p_ip: ip });
  if (error) throw error;
  return (data as IntelCategory | null) ?? null;
}

export async function getAsnIntel(db: SupabaseClient, asn: number): Promise<AsnIntel | null> {
  const { data, error } = await db.from('asn_intel').select('asn, org_name, category').eq('asn', asn).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { asn: data.asn, orgName: data.org_name, category: data.category };
}

export async function insertVerdict(
  db: SupabaseClient,
  params: { messageId: string; rawEventId: string; verdict: Verdict; reason: string },
): Promise<void> {
  const { error } = await db
    .from('verdicts')
    .insert({ message_id: params.messageId, raw_event_id: params.rawEventId, verdict: params.verdict, reason: params.reason });
  if (error) throw error;
}

export async function updateMessageStatus(db: SupabaseClient, messageId: string, status: MessageStatus): Promise<void> {
  const { error } = await db
    .from('messages')
    .update({ status, status_updated_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

export async function deleteMessage(db: SupabaseClient, messageId: string, userId: string): Promise<boolean> {
  const { error, count } = await db.from('messages').delete({ count: 'exact' }).eq('id', messageId).eq('user_id', userId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function getMessageById(db: SupabaseClient, messageId: string): Promise<MessageRow | null> {
  const { data, error } = await db
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface UnclassifiedEvent {
  id: string;
  message_id: string;
  kind: EventKind;
  occurred_at: string;
  user_agent: string | null;
  asn: number | null;
  ip_category: IntelCategory | null;
  fetch_sequence_ms: number;
}

/** Batch of raw_events not yet run through the classifier, oldest first. Used by the cron sweep. */
export async function getUnclassifiedRawEvents(db: SupabaseClient, limit = 200): Promise<UnclassifiedEvent[]> {
  const { data, error } = await db
    .from('raw_events')
    .select('id, message_id, kind, occurred_at, user_agent, asn, ip_category, fetch_sequence_ms')
    .is('classified_at', null)
    .order('occurred_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Prior fetch context needed for classification: has this message ever had a
 * pixel fetch before, and how many fetches landed within a 2s burst window
 * of `occurredAt` (inclusive of the event itself, which the caller already
 * counts once — see rules.ts BURST_THRESHOLD).
 */
export async function getPriorFetchContext(
  db: SupabaseClient,
  messageId: string,
  excludeEventId: string,
  occurredAt: string,
): Promise<{ isFirstFetch: boolean; burstFetchCount: number }> {
  const { data, error } = await db
    .from('raw_events')
    .select('id, occurred_at')
    .eq('message_id', messageId)
    .eq('kind', 'pixel_fetch')
    .neq('id', excludeEventId);
  if (error) throw error;
  const priorFetches = data ?? [];
  const occurredMs = new Date(occurredAt).getTime();
  const burstNeighbors = priorFetches.filter((e) => Math.abs(new Date(e.occurred_at).getTime() - occurredMs) <= 2_000);
  return { isFirstFetch: priorFetches.length === 0, burstFetchCount: burstNeighbors.length + 1 };
}

export async function markRawEventClassified(db: SupabaseClient, eventId: string): Promise<void> {
  const { error } = await db.from('raw_events').update({ classified_at: new Date().toISOString() }).eq('id', eventId);
  if (error) throw error;
}

export interface TimelineRow {
  occurred_at: string;
  kind: EventKind;
  verdict: Verdict;
  reason: string;
}

export async function getMessageTimeline(db: SupabaseClient, messageId: string): Promise<TimelineRow[]> {
  const { data, error } = await db
    .from('verdicts')
    .select('verdict, reason, raw_events(occurred_at, kind)')
    .eq('message_id', messageId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const rawEvent = Array.isArray(row.raw_events) ? row.raw_events[0] : row.raw_events;
    return {
      occurred_at: rawEvent?.occurred_at ?? '',
      kind: (rawEvent?.kind as EventKind) ?? 'pixel_fetch',
      verdict: row.verdict as Verdict,
      reason: row.reason,
    };
  });
}
