import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMsgIdForGmailMessage,
  getPollCursor,
  getSavedAccounts,
  getSettings,
  getTrackedThread,
  hasReportedBounce,
  hasReportedReply,
  markBounceReported,
  markReplyReported,
  recordGmailMessageId,
  recordThreadForMessage,
  removeSavedAccount,
  setPollCursor,
  setSettings,
  switchToSavedAccount,
  upsertSavedAccount,
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
    expect(settings).toEqual({
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
      checkLinksForSafety: true,
    });
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

  it('saved accounts: upsert, list, and dedup by gmailEmail', async () => {
    await upsertSavedAccount({ gmailEmail: 'a@gmail.com', apiKey: 'key-a', accountEmail: 'a@gmail.com' });
    await upsertSavedAccount({ gmailEmail: 'b@gmail.com', apiKey: 'key-b', accountEmail: 'b@gmail.com' });
    expect(await getSavedAccounts()).toHaveLength(2);

    // Re-saving the same gmailEmail replaces, doesn't duplicate.
    await upsertSavedAccount({ gmailEmail: 'a@gmail.com', apiKey: 'key-a-rotated', accountEmail: 'a@gmail.com' });
    const accounts = await getSavedAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts.find((a) => a.gmailEmail === 'a@gmail.com')?.apiKey).toBe('key-a-rotated');
  });

  it('switchToSavedAccount makes a saved account the active global identity', async () => {
    await upsertSavedAccount({ gmailEmail: 'a@gmail.com', apiKey: 'key-a', accountEmail: 'a@gmail.com' });
    await setSettings({ apiKey: 'some-other-key', accountEmail: 'other@gmail.com' });

    const switched = await switchToSavedAccount('a@gmail.com');
    expect(switched?.apiKey).toBe('key-a');

    const settings = await getSettings();
    expect(settings.apiKey).toBe('key-a');
    expect(settings.accountEmail).toBe('a@gmail.com');
  });

  it('switchToSavedAccount returns null for an unknown account and does not touch settings', async () => {
    await setSettings({ apiKey: 'unchanged-key' });
    const result = await switchToSavedAccount('nope@gmail.com');
    expect(result).toBeNull();
    expect((await getSettings()).apiKey).toBe('unchanged-key');
  });

  it('removeSavedAccount removes only the targeted account', async () => {
    await upsertSavedAccount({ gmailEmail: 'a@gmail.com', apiKey: 'key-a', accountEmail: null });
    await upsertSavedAccount({ gmailEmail: 'b@gmail.com', apiKey: 'key-b', accountEmail: null });
    await removeSavedAccount('a@gmail.com');
    const accounts = await getSavedAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.gmailEmail).toBe('b@gmail.com');
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

  it('bounce dedup: unreported by default, reported after marking', async () => {
    expect(await hasReportedBounce('gmail-bounce-1')).toBe(false);
    await markBounceReported('gmail-bounce-1');
    expect(await hasReportedBounce('gmail-bounce-1')).toBe(true);
    expect(await hasReportedBounce('gmail-bounce-2')).toBe(false); // marking one ID doesn't affect another
  });

  it('thread map: records and looks up a tracked thread, lowercasing recipient emails for case-insensitive reply matching', async () => {
    await recordThreadForMessage('thread-1', 'msg-a', ['Recipient@Example.com', ' other@example.com ']);
    const tracked = await getTrackedThread('thread-1');
    expect(tracked?.msgId).toBe('msg-a');
    expect(tracked?.recipientEmails).toEqual(['recipient@example.com', 'other@example.com']);
    expect(await getTrackedThread('untracked-thread')).toBeNull();
  });

  it('reply dedup: unreported by default, reported after marking', async () => {
    expect(await hasReportedReply('gmail-reply-1')).toBe(false);
    await markReplyReported('gmail-reply-1');
    expect(await hasReportedReply('gmail-reply-1')).toBe(true);
    expect(await hasReportedReply('gmail-reply-2')).toBe(false);
  });
});
