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
}

const DEFAULT_SETTINGS: MailTrackSettings = {
  apiKey: null,
  accountEmail: null,
  trackingEnabledByDefault: true,
  notificationsEnabled: true,
  bounceDetectionEnabled: true,
};

const SETTINGS_KEY = 'mailtrack:settings';
const GMAIL_ID_MAP_KEY = 'mailtrack:gmailIdToMsgId';
const POLL_CURSOR_KEY = 'mailtrack:pollCursor';
const REPORTED_BOUNCES_KEY = 'mailtrack:reportedBounceMessageIds';
/** Bounded so this can't grow forever in chrome.storage.local — only needs to dedupe within roughly one Gmail session. */
const MAX_TRACKED_REPORTED_BOUNCES = 500;

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
