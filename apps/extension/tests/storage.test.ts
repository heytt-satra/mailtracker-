import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMsgIdForGmailMessage,
  getPollCursor,
  getSettings,
  recordGmailMessageId,
  setPollCursor,
  setSettings,
} from '../src/storage';

function installFakeChromeStorage() {
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
      },
    },
  };
}

describe('storage', () => {
  beforeEach(() => {
    installFakeChromeStorage();
  });

  it('getSettings returns defaults when nothing is stored', async () => {
    const settings = await getSettings();
    expect(settings).toEqual({ apiKey: null, accountEmail: null, trackingEnabledByDefault: true, notificationsEnabled: true });
  });

  it('setSettings merges into existing settings rather than replacing them', async () => {
    await setSettings({ apiKey: 'k1' });
    const afterFirst = await getSettings();
    expect(afterFirst.trackingEnabledByDefault).toBe(true); // untouched default preserved

    await setSettings({ trackingEnabledByDefault: false });
    const afterSecond = await getSettings();
    expect(afterSecond.apiKey).toBe('k1'); // first write preserved
    expect(afterSecond.trackingEnabledByDefault).toBe(false);
  });

  it('records and looks up gmail message id -> msgId mappings', async () => {
    await recordGmailMessageId('gmail-1', 'msg-a');
    await recordGmailMessageId('gmail-2', 'msg-b');
    expect(await getMsgIdForGmailMessage('gmail-1')).toBe('msg-a');
    expect(await getMsgIdForGmailMessage('gmail-2')).toBe('msg-b');
    expect(await getMsgIdForGmailMessage('unknown')).toBeNull();
  });

  it('poll cursor defaults to epoch and round-trips a set value', async () => {
    expect(await getPollCursor()).toBe(new Date(0).toISOString());
    await setPollCursor('2026-07-08T12:00:00.000Z');
    expect(await getPollCursor()).toBe('2026-07-08T12:00:00.000Z');
  });
});
