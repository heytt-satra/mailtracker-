/** Thin typed wrapper around chrome.storage.local. All extension state lives here. */

export interface MailTrackSettings {
  apiKey: string | null;
  trackingEnabledByDefault: boolean;
  notificationsEnabled: boolean;
}

const DEFAULT_SETTINGS: MailTrackSettings = {
  apiKey: null,
  trackingEnabledByDefault: true,
  notificationsEnabled: true,
};

const SETTINGS_KEY = 'mailtrack:settings';
const GMAIL_ID_MAP_KEY = 'mailtrack:gmailIdToMsgId';
const POLL_CURSOR_KEY = 'mailtrack:pollCursor';

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

export async function getPollCursor(): Promise<string> {
  const stored = await chrome.storage.local.get(POLL_CURSOR_KEY);
  return stored[POLL_CURSOR_KEY] ?? new Date(0).toISOString();
}

export async function setPollCursor(iso: string): Promise<void> {
  await chrome.storage.local.set({ [POLL_CURSOR_KEY]: iso });
}
