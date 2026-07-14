/** Thin typed wrapper around chrome.storage.local. All extension state lives here. */

export interface MailTrackSettings {
  apiKey: string | null;
  /** The email that was signed in when apiKey was provisioned — display-only, not used for auth. Null for a manually-pasted key (no signup flow). */
  accountEmail: string | null;
  trackingEnabledByDefault: boolean;
  notificationsEnabled: boolean;
  /**
   * ADR-20. Reads message bodies in the sender's own inbox to recognize
   * Gmail's bounce-notification format — a broader read than anything else
   * this extension does (everything else only ever reads message IDs or the
   * sender's own compose draft), so it's visible and toggleable rather than
   * silently on, even though it's on by default and narrowly scoped (only
   * messages whose sender matches mailer-daemon/postmaster are ever read).
   */
  bounceDetectionEnabled: boolean;
  /** User-configurable follow-up-reminder thresholds (see follow-up.ts) — replaces the previously-hardcoded 3/5-day constants. */
  followUpNotOpenedDays: number;
  followUpOpenedNoReplyDays: number;
  /**
   * Per-alert-type notification toggles — all gated behind the master
   * `notificationsEnabled` switch above, so turning that off still silences
   * everything regardless of these. Lets a user keep e.g. reply alerts on
   * while muting routine open notifications, instead of all-or-nothing.
   */
  notifyOnOpen: boolean;
  notifyOnClick: boolean;
  notifyOnReply: boolean;
  notifyOnBounce: boolean;
  notifyOnHotConversation: boolean;
  notifyOnRevival: boolean;
  notifyOnFollowUp: boolean;
  /**
   * ADR-40. Off by default — this is a real behavior change, not a pure
   * enhancement: composing to N recipients normally sends ONE email
   * everyone can see everyone else on; enabling this splits it into N
   * separate personalized sends, so recipients no longer see each other.
   * Opt-in because that's a meaningful semantic difference the user should
   * choose deliberately, not something silently turned on.
   */
  individualTrackingForGroupEmails: boolean;
}

const DEFAULT_SETTINGS: MailTrackSettings = {
  apiKey: null,
  accountEmail: null,
  trackingEnabledByDefault: true,
  notificationsEnabled: true,
  bounceDetectionEnabled: true,
  followUpNotOpenedDays: 3,
  followUpOpenedNoReplyDays: 5,
  notifyOnOpen: true,
  notifyOnClick: true,
  notifyOnReply: true,
  notifyOnBounce: true,
  notifyOnHotConversation: true,
  notifyOnRevival: true,
  notifyOnFollowUp: true,
  individualTrackingForGroupEmails: false,
};

const SETTINGS_KEY = 'mailtrack:settings';
const GMAIL_ID_MAP_KEY = 'mailtrack:gmailIdToMsgId';
const POLL_CURSOR_KEY = 'mailtrack:pollCursor';
const REPORTED_BOUNCES_KEY = 'mailtrack:reportedBounceMessageIds';
const THREAD_MAP_KEY = 'mailtrack:threadToTrackedMessage';
const REPORTED_REPLIES_KEY = 'mailtrack:reportedReplyMessageIds';
/** Bounded so these can't grow forever in chrome.storage.local — only need to dedupe within roughly one Gmail session. */
const MAX_TRACKED_REPORTED_BOUNCES = 500;
const MAX_TRACKED_REPLIES = 500;
const MAX_TRACKED_THREADS = 500;

export async function getSettings(): Promise<MailTrackSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] ?? {}) };
}

export async function setSettings(partial: Partial<MailTrackSettings>): Promise<MailTrackSettings> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
  return updated;
}

/**
 * Maps a Gmail message ID (known only after InboxSDK's `sent` event fires)
 * to the msgId MailTrack's backend assigned at `presending` time. The
 * sent-thread status chip looks up by Gmail message ID, so this bridges the
 * two ID spaces without needing a backend lookup-by-gmail-id endpoint.
 */
export async function recordGmailMessageId(gmailMessageId: string, msgId: string): Promise<void> {
  const stored = await chrome.storage.local.get(GMAIL_ID_MAP_KEY);
  const map: Record<string, string> = stored[GMAIL_ID_MAP_KEY] ?? {};
  map[gmailMessageId] = msgId;
  await chrome.storage.local.set({ [GMAIL_ID_MAP_KEY]: map });
}

export async function getMsgIdForGmailMessage(gmailMessageId: string): Promise<string | null> {
  const stored = await chrome.storage.local.get(GMAIL_ID_MAP_KEY);
  const map: Record<string, string> = stored[GMAIL_ID_MAP_KEY] ?? {};
  return map[gmailMessageId] ?? null;
}

/**
 * ADR-21. Records which tracked message (and its recipient emails) a Gmail
 * thread belongs to, captured at send time. Reply detection reads this to
 * know (a) whether an inbound message is in a thread we care about, and (b)
 * whether its sender is the original recipient (a reply) vs. our own
 * follow-up. Recipient emails are stored lowercased for case-insensitive
 * matching. Bounded to the most-recent MAX_TRACKED_THREADS entries.
 */
export interface TrackedThread {
  msgId: string;
  recipientEmails: string[];
}

export async function recordThreadForMessage(threadId: string, msgId: string, recipientEmails: string[]): Promise<void> {
  const stored = await chrome.storage.local.get(THREAD_MAP_KEY);
  const map: Record<string, TrackedThread> = stored[THREAD_MAP_KEY] ?? {};
  map[threadId] = { msgId, recipientEmails: recipientEmails.map((e) => e.trim().toLowerCase()).filter(Boolean) };
  const entries = Object.entries(map);
  const trimmed = entries.length > MAX_TRACKED_THREADS ? Object.fromEntries(entries.slice(-MAX_TRACKED_THREADS)) : map;
  await chrome.storage.local.set({ [THREAD_MAP_KEY]: trimmed });
}

export async function getTrackedThread(threadId: string): Promise<TrackedThread | null> {
  const stored = await chrome.storage.local.get(THREAD_MAP_KEY);
  const map: Record<string, TrackedThread> = stored[THREAD_MAP_KEY] ?? {};
  return map[threadId] ?? null;
}

/** Dedup guard for reply reporting — same reasoning as hasReportedBounce; keyed by the reply message's own Gmail ID. */
export async function hasReportedReply(replyGmailMessageId: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(REPORTED_REPLIES_KEY);
  const ids: string[] = stored[REPORTED_REPLIES_KEY] ?? [];
  return ids.includes(replyGmailMessageId);
}

export async function markReplyReported(replyGmailMessageId: string): Promise<void> {
  const stored = await chrome.storage.local.get(REPORTED_REPLIES_KEY);
  const ids: string[] = stored[REPORTED_REPLIES_KEY] ?? [];
  if (ids.includes(replyGmailMessageId)) return;
  const updated = [...ids, replyGmailMessageId].slice(-MAX_TRACKED_REPLIES);
  await chrome.storage.local.set({ [REPORTED_REPLIES_KEY]: updated });
}

/**
 * Dedup guard for bounce reporting (ADR-20): InboxSDK's message-view handler
 * can fire again for the same message (re-render, thread re-open), and
 * without this every re-render would re-POST the same bounce to the backend.
 * Keyed by the bounce notification's own Gmail message ID, not the tracked
 * message it correlates to — one bounce email should only ever be reported once.
 */
export async function hasReportedBounce(gmailMessageId: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(REPORTED_BOUNCES_KEY);
  const ids: string[] = stored[REPORTED_BOUNCES_KEY] ?? [];
  return ids.includes(gmailMessageId);
}

export async function markBounceReported(gmailMessageId: string): Promise<void> {
  const stored = await chrome.storage.local.get(REPORTED_BOUNCES_KEY);
  const ids: string[] = stored[REPORTED_BOUNCES_KEY] ?? [];
  if (ids.includes(gmailMessageId)) return;
  const updated = [...ids, gmailMessageId].slice(-MAX_TRACKED_REPORTED_BOUNCES);
  await chrome.storage.local.set({ [REPORTED_BOUNCES_KEY]: updated });
}

export async function getPollCursor(): Promise<string> {
  const stored = await chrome.storage.local.get(POLL_CURSOR_KEY);
  return stored[POLL_CURSOR_KEY] ?? new Date(0).toISOString();
}

export async function setPollCursor(iso: string): Promise<void> {
  await chrome.storage.local.set({ [POLL_CURSOR_KEY]: iso });
}

/**
 * Follow-up reminders are a daily-cadence nudge, not a real-time event like
 * opens/clicks — the alarm that checks for them can fire more than once a
 * day (self-healing, same as the poll alarm), so this date string is what
 * actually caps the notification to once per calendar day rather than the
 * alarm's own period.
 */
const LAST_FOLLOW_UP_NOTIFIED_DATE_KEY = 'mailtrack:lastFollowUpNotifiedDate';

export async function getLastFollowUpNotifiedDate(): Promise<string | null> {
  const stored = await chrome.storage.local.get(LAST_FOLLOW_UP_NOTIFIED_DATE_KEY);
  return stored[LAST_FOLLOW_UP_NOTIFIED_DATE_KEY] ?? null;
}

export async function setLastFollowUpNotifiedDate(dateString: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_FOLLOW_UP_NOTIFIED_DATE_KEY]: dateString });
}
