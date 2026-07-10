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
    // Loud on purpose (ADR-27): reply detection later looks this thread id up,
    // and every failure in that path is a silent return — so the one place we
    // CAN see what was stored, we log it, to make a mismatch diagnosable.
    console.info('[MailTrack] recorded sent thread for reply detection:', { threadId, msgId, recipientEmails });
    if (threadId) await recordThreadForMessage(threadId, msgId, recipientEmails);
  } catch (err) {
    console.warn('[MailTrack] could not record thread for reply detection:', err);
  }
}
