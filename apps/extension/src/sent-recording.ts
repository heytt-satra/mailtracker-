import { recordGmailMessageId, recordThreadForMessage } from './storage';
import type { SentEvent } from './inboxsdk-types';

/**
 * Records everything the compose 'sent' event gives us, for the status chip
 * (gmail message id -> msgId) and reply detection (thread id -> msgId +
 * recipients). Extracted from inboxsdk-app.ts so it's unit-testable without
 * the InboxSDK loader's side effects — and specifically so the async bug it
 * fixes (ADR-25) can't silently return: getMessageID()/getThreadID() are
 * Promise-returning, and this awaits them. Each record is guarded
 * independently so a failure in one doesn't drop the other.
 */
export async function recordSentMessage(event: SentEvent, msgId: string, recipientEmails: string[]): Promise<void> {
  try {
    const gmailMessageId = await event.getMessageID();
    if (gmailMessageId) await recordGmailMessageId(gmailMessageId, msgId);
  } catch (err) {
    console.warn('[MailTrack] could not record Gmail message id for status chip:', err);
  }
  try {
    const threadId = await event.getThreadID();
    if (threadId) await recordThreadForMessage(threadId, msgId, recipientEmails);
  } catch (err) {
    console.warn('[MailTrack] could not record thread for reply detection:', err);
  }
}
