import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AsnIntel, BeaconPosition, EventKind, IntelCategory, MessageStatus, MessageSummary, Verdict } from '@mailtrack/shared';
import type { Env } from '../types';
import { computeReadSignal, type ReadSignal } from '../read-signal';
import { computeDepthReached } from '../depth-signal';

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

export interface UserWithEmailRow {
  id: string;
  email: string | null;
}

export async function getUserById(db: SupabaseClient, userId: string): Promise<UserWithEmailRow | null> {
  const { data, error } = await db.from('users').select('id, email').eq('id', userId).maybeSingle();
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
  params: { userId: string; gmailMessageId?: string; subject?: string; recipient?: string; pixelToken: string },
): Promise<MessageRow> {
  const { data, error } = await db
    .from('messages')
    .insert({
      user_id: params.userId,
      gmail_message_id: params.gmailMessageId ?? null,
      subject: params.subject ?? null,
      recipient: params.recipient ?? null,
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
  recipient: string | null;
  status: MessageStatus;
  sent_at: string;
  bounce_detected_at: string | null;
  bounce_reason: string | null;
  reply_detected_at: string | null;
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
    .select('id, subject, recipient, status, sent_at, bounce_detected_at, bounce_reason, reply_detected_at')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .range(offset, offset + LIST_PAGE_SIZE - 1);
  if (error) throw error;
  const rows = data ?? [];
  return { rows, nextOffset: rows.length === LIST_PAGE_SIZE ? offset + LIST_PAGE_SIZE : null };
}

/**
 * All of a user's messages sent within [startIso, endIso) — feeds the
 * weekly/monthly reports tab (reports.ts::computeReportStats). Same row
 * shape as listMessagesForUser (MessageSummaryRow) so routes/reports.ts can
 * reuse buildMessageSummary() to attach a full per-message detail list
 * (including reply/bounce evidence) alongside the aggregate stats, not just
 * recipient/sent_at. Capped at MAX_REPORT_MESSAGES so a very large send
 * history can't turn a report request into an unbounded query; a report is
 * a rough trend view, not an exhaustive export (CSV export already covers
 * the single-message case).
 */
const MAX_REPORT_MESSAGES = 2000;

export async function getMessagesForReport(db: SupabaseClient, userId: string, startIso: string, endIso: string): Promise<MessageSummaryRow[]> {
  const { data, error } = await db
    .from('messages')
    .select('id, subject, recipient, status, sent_at, bounce_detected_at, bounce_reason, reply_detected_at')
    .eq('user_id', userId)
    .gte('sent_at', startIso)
    .lt('sent_at', endIso)
    .order('sent_at', { ascending: false })
    .limit(MAX_REPORT_MESSAGES);
  if (error) throw error;
  return data ?? [];
}

/**
 * Candidate messages for bounce correlation (ADR-20): every non-bounced
 * message this user sent in the last MAX_BOUNCE_DELAY_MS window (see
 * bounce-correlation.ts) — recipient/subject narrowing happens in the pure
 * correlateBounce() function, not here, so that logic stays testable
 * without a database.
 */
export async function getBounceCandidateMessages(
  db: SupabaseClient,
  userId: string,
  sinceIso: string,
): Promise<{ id: string; recipient: string | null; subject: string | null; sentAt: string }[]> {
  const { data, error } = await db
    .from('messages')
    .select('id, recipient, subject, sent_at')
    .eq('user_id', userId)
    .is('bounce_detected_at', null)
    .gte('sent_at', sinceIso);
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, recipient: row.recipient, subject: row.subject, sentAt: row.sent_at }));
}

export async function markMessageBounced(db: SupabaseClient, messageId: string, params: { detectedAt: string; reason: string }): Promise<void> {
  const { error } = await db.from('messages').update({ bounce_detected_at: params.detectedAt, bounce_reason: params.reason }).eq('id', messageId);
  if (error) throw error;
}

/**
 * ADR-21. Records a reply and escalates status to 'replied' — the top of the
 * ladder, so this always wins the escalate-only guard, but it's applied via
 * the same status field rather than a side channel so the dashboard's status
 * badge and the read-confidence override stay in sync. Idempotent: reporting
 * the same reply twice just re-writes the same values.
 */
export async function markMessageReplied(db: SupabaseClient, messageId: string, params: { detectedAt: string }): Promise<void> {
  const { error } = await db
    .from('messages')
    .update({ reply_detected_at: params.detectedAt, status: 'replied', status_updated_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

export interface VerdictStats extends ReadSignal {
  openCount: number;
  clickCount: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  depthReached: ReturnType<typeof computeDepthReached>;
}

/**
 * Aggregated per-message open/click counts, plus the Read Confidence verdict
 * (ADR-18), for a page of messages. Supabase's fluent query builder has no
 * GROUP BY, and this doesn't need a Postgres function (unlike
 * classify_ip_category, which runs on the pixel/click hot path) — it's a
 * bounded read (one page of messages at a time, LIST_PAGE_SIZE = 50) on a
 * dashboard endpoint, so aggregating the raw verdict rows in JS is simpler
 * than adding another SQL function for a one-off admin-page query.
 *
 * Fetches ALL verdict kinds (not just verified_open/verified_click) because
 * computeReadSignal needs machine_suspect/not_verifiable rows too, to tell
 * "auto-only activity seen" apart from "nothing happened yet" — see
 * read-signal.ts. Also joins raw_events.beacon_position (ADR-19) so
 * computeDepthReached can run in the same pass — see depth-signal.ts.
 */
export async function getVerdictStatsForMessages(db: SupabaseClient, messageIds: string[]): Promise<Map<string, VerdictStats>> {
  const stats = new Map<string, VerdictStats>();
  if (messageIds.length === 0) return stats;

  const { data, error } = await db
    .from('verdicts')
    .select('message_id, verdict, created_at, raw_events(beacon_position)')
    .in('message_id', messageIds)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const eventsByMessage = new Map<string, { verdict: Verdict; createdAt: string; beaconPosition: BeaconPosition | null }[]>();

  for (const row of data ?? []) {
    const entry = stats.get(row.message_id) ?? {
      openCount: 0,
      clickCount: 0,
      firstOpenedAt: null,
      lastOpenedAt: null,
      readConfidence: null,
      minEngagedSeconds: null,
      readEvidence: null,
      depthReached: null,
      sessionCount: null,
      syncSuspect: false,
    };
    if (row.verdict === 'verified_open') {
      entry.openCount++;
      entry.firstOpenedAt ??= row.created_at;
      entry.lastOpenedAt = row.created_at;
    } else if (row.verdict === 'verified_click') {
      entry.clickCount++;
    }
    stats.set(row.message_id, entry);

    const rawEvent = Array.isArray(row.raw_events) ? row.raw_events[0] : row.raw_events;
    const events = eventsByMessage.get(row.message_id) ?? [];
    events.push({ verdict: row.verdict as Verdict, createdAt: row.created_at, beaconPosition: (rawEvent?.beacon_position as BeaconPosition | null) ?? null });
    eventsByMessage.set(row.message_id, events);
  }

  for (const [messageId, events] of eventsByMessage) {
    const entry = stats.get(messageId)!;
    Object.assign(entry, computeReadSignal(events));
    entry.depthReached = computeDepthReached(events);
  }

  return stats;
}

const EMPTY_VERDICT_STATS: VerdictStats = {
  openCount: 0,
  clickCount: 0,
  firstOpenedAt: null,
  lastOpenedAt: null,
  readConfidence: null,
  minEngagedSeconds: null,
  readEvidence: null,
  depthReached: null,
  sessionCount: null,
  syncSuspect: false,
};

/**
 * Maps a message row + its verdict stats into the shared `MessageSummary`
 * shape the dashboard renders — factored out so `GET /v1/messages` (events.ts)
 * and the reports endpoint (routes/reports.ts) build IDENTICAL rows from the
 * same logic, instead of two hand-copies that could silently drift apart.
 * ADR-21: a reply is definitive proof of reading, so it overrides the
 * pixel/click-derived read confidence with the strongest possible verdict —
 * no sync/proxy ambiguity can produce a reply — and its evidence text names
 * the exact reply timestamp.
 */
export function buildMessageSummary(row: MessageSummaryRow, stats: VerdictStats | undefined): MessageSummary {
  const rowStats = stats ?? EMPTY_VERDICT_STATS;
  const bounce = row.bounce_detected_at ? { detectedAt: row.bounce_detected_at, reason: row.bounce_reason ?? '' } : null;
  const reply = row.reply_detected_at ? { detectedAt: row.reply_detected_at } : null;
  const withReply = reply
    ? { ...rowStats, readConfidence: 'read' as const, readEvidence: `Replied to your email — definitive proof they read it (${reply.detectedAt}).` }
    : rowStats;
  return { msgId: row.id, subject: row.subject, recipient: row.recipient, status: row.status, sentAt: row.sent_at, ...withReply, bounce, reply };
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

/** ADR-19: two extra beacon tokens (mid/bottom), generated only for messages long enough to warrant depth tracking. */
export async function insertBeaconTokens(
  db: SupabaseClient,
  messageId: string,
  beacons: { token: string; position: Extract<BeaconPosition, 'mid' | 'bottom'> }[],
): Promise<void> {
  if (beacons.length === 0) return;
  const { error } = await db
    .from('beacon_tokens')
    .insert(beacons.map((b) => ({ message_id: messageId, token: b.token, position: b.position })));
  if (error) throw error;
}

/** Distinct from getMessageByPixelToken: a beacon token resolves through beacon_tokens, not messages.pixel_token — keeps the original open-detection path untouched (ADR-19). */
export async function getMessageByBeaconToken(
  db: SupabaseClient,
  beaconToken: string,
): Promise<{ message: MessageRow; position: Extract<BeaconPosition, 'mid' | 'bottom'> } | null> {
  const { data, error } = await db
    .from('beacon_tokens')
    .select(`position, messages(${MESSAGE_COLUMNS})`)
    .eq('token', beaconToken)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const message = Array.isArray(data.messages) ? data.messages[0] : data.messages;
  if (!message) return null;
  return { message, position: data.position as Extract<BeaconPosition, 'mid' | 'bottom'> };
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
    /**
     * Explicit rather than relying on the column default so the caller can
     * classify inline (ADR-15) with an `occurred_at` value guaranteed
     * identical to what's stored, instead of reading it back with a second
     * round-trip.
     */
    occurredAt: string;
    /** ADR-19. 'top' for the primary pixel, 'mid'/'bottom' for depth beacons, undefined/null for link_click. */
    beaconPosition?: BeaconPosition | null;
    /** ADR-30. The real destination URL for a link_click row (not our redirect token) — null/undefined for pixel_fetch. */
    clickedUrl?: string | null;
  },
): Promise<{ id: string; occurredAt: string }> {
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
      occurred_at: params.occurredAt,
      beacon_position: params.beaconPosition ?? null,
      clicked_url: params.clickedUrl ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id, occurredAt: params.occurredAt };
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

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'expired';

/**
 * ADR-36. Upserted only from the Dodo webhook handler, keyed on
 * dodo_subscription_id (not user_id) so a user resubscribing after
 * cancellation creates a fresh row rather than colliding with the old one.
 */
export async function upsertSubscription(
  db: SupabaseClient,
  params: { userId: string; dodoSubscriptionId: string; status: SubscriptionStatus; currentPeriodEnd: string | null },
): Promise<void> {
  const { error } = await db.from('subscriptions').upsert(
    {
      user_id: params.userId,
      dodo_subscription_id: params.dodoSubscriptionId,
      status: params.status,
      current_period_end: params.currentPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'dodo_subscription_id' },
  );
  if (error) throw error;
}

export async function markSubscriptionStatus(
  db: SupabaseClient,
  dodoSubscriptionId: string,
  status: Exclude<SubscriptionStatus, 'active'>,
): Promise<void> {
  const { error } = await db
    .from('subscriptions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('dodo_subscription_id', dodoSubscriptionId);
  if (error) throw error;
}

/** Gates POST /v1/messages (ADR-36) — historical data and already-tracked messages stay unaffected either way. */
export async function hasActiveSubscription(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db.from('subscriptions').select('id').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** All verified-open timestamps for a message, sorted ascending — feeds isHotConversation/isRevival (engagement-alerts.ts). */
export async function getVerifiedOpenTimestamps(db: SupabaseClient, messageId: string): Promise<string[]> {
  const { data, error } = await db
    .from('verdicts')
    .select('created_at, raw_events(occurred_at)')
    .eq('message_id', messageId)
    .eq('verdict', 'verified_open')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const rawEvent = Array.isArray(row.raw_events) ? row.raw_events[0] : row.raw_events;
    return rawEvent?.occurred_at ?? row.created_at;
  });
}

export interface RecentOpenEvent {
  messageId: string;
  occurredAt: string;
  recipient: string | null;
  subject: string | null;
}

/** Verified opens classified since the last poll, across this user's messages — used to detect fresh Hot Conversation / Revival alerts. */
export async function getRecentVerifiedOpens(db: SupabaseClient, userId: string, sinceIso: string): Promise<RecentOpenEvent[]> {
  const { data, error } = await db
    .from('verdicts')
    .select('message_id, created_at, raw_events(occurred_at), messages!inner(recipient, subject, user_id)')
    .eq('verdict', 'verified_open')
    .eq('messages.user_id', userId)
    .gt('created_at', sinceIso);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const rawEvent = Array.isArray(row.raw_events) ? row.raw_events[0] : row.raw_events;
    const message = Array.isArray(row.messages) ? row.messages[0] : row.messages;
    return {
      messageId: row.message_id,
      occurredAt: rawEvent?.occurred_at ?? row.created_at,
      recipient: message?.recipient ?? null,
      subject: message?.subject ?? null,
    };
  });
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
  /** ADR-30. The real destination URL for a link_click row, null otherwise. */
  clicked_url: string | null;
}

export async function getMessageTimeline(db: SupabaseClient, messageId: string): Promise<TimelineRow[]> {
  const { data, error } = await db
    .from('verdicts')
    .select('verdict, reason, raw_events(occurred_at, kind, clicked_url)')
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
      clicked_url: rawEvent?.clicked_url ?? null,
    };
  });
}
