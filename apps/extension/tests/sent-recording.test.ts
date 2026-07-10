import { beforeEach, describe, expect, it } from 'vitest';
import { recordSentMessage } from '../src/sent-recording';
import { getMsgIdForGmailMessage, getTrackedThread } from '../src/storage';
import type { SentEvent } from '../src/inboxsdk-types';

function installFakeChromeStorage() {
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: async (k: string) => ({ [k]: store[k] }), set: async (i: Record<string, unknown>) => void Object.assign(store, i) } },
  };
}

/**
 * Regression guard for ADR-25: the compose 'sent' event's getMessageID() and
 * getThreadID() are ASYNC (Promise<string>). The original code called them
 * synchronously, so the resolved-vs-Promise distinction is exactly what
 * broke reply detection and the status chip. These tests use an event whose
 * methods return Promises and assert the RESOLVED string became the map key.
 */
describe('recordSentMessage (ADR-25 async sent-event handling)', () => {
  beforeEach(installFakeChromeStorage);

  const asyncEvent: SentEvent = {
    getMessageID: () => Promise.resolve('gmail-msg-123'),
    getThreadID: () => Promise.resolve('thread-abc'),
  };

  it('stores the RESOLVED gmail message id (not a Promise) so the status chip lookup matches', async () => {
    await recordSentMessage(asyncEvent, 'mt-msg-1', ['r@example.com']);
    expect(await getMsgIdForGmailMessage('gmail-msg-123')).toBe('mt-msg-1');
    // The old bug would have keyed the map by String(Promise) === "[object Promise]".
    expect(await getMsgIdForGmailMessage('[object Promise]')).toBeNull();
  });

  it('stores the RESOLVED thread id + recipients so reply detection can correlate', async () => {
    await recordSentMessage(asyncEvent, 'mt-msg-1', ['Recipient@Example.com']);
    const tracked = await getTrackedThread('thread-abc');
    expect(tracked?.msgId).toBe('mt-msg-1');
    expect(tracked?.recipientEmails).toEqual(['recipient@example.com']);
  });

  it('records the thread even if getMessageID rejects — the two are guarded independently', async () => {
    const partialEvent: SentEvent = {
      getMessageID: () => Promise.reject(new Error('no message id yet')),
      getThreadID: () => Promise.resolve('thread-xyz'),
    };
    await recordSentMessage(partialEvent, 'mt-msg-2', ['a@b.com']);
    expect((await getTrackedThread('thread-xyz'))?.msgId).toBe('mt-msg-2');
  });
});
