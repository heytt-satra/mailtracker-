/**
 * ADR-61 (Outlook add-in, C2). localStorage-backed equivalent of
 * apps/extension/src/storage.ts's chrome.storage.local wrapper — the task
 * pane and the on-send function-file are both served from the same origin
 * (see apps/backend/src/pages/outlook-addin.ts), so localStorage is shared
 * between them, same as chrome.storage.local is shared across the
 * extension's own surfaces. Deliberately a much smaller settings shape than
 * the extension's — this MVP has no notifications, follow-ups, or
 * individual-send mode to store state for (see PLAN.md's Outlook MVP scope).
 */

export interface MailTrackSettings {
  apiKey: string | null;
  accountEmail: string | null;
  trackingEnabledByDefault: boolean;
}

const DEFAULT_SETTINGS: MailTrackSettings = {
  apiKey: null,
  accountEmail: null,
  trackingEnabledByDefault: true,
};

const SETTINGS_KEY = 'mailtrack:settings';

export function getSettings(): MailTrackSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function setSettings(partial: Partial<MailTrackSettings>): MailTrackSettings {
  const updated = { ...getSettings(), ...partial };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  return updated;
}
