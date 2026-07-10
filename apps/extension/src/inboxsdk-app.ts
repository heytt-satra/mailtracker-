import * as InboxSDKLoader from '@inboxsdk/core';
import { COMPOSE_INJECTION_TIMEOUT_MS, INBOXSDK_APP_ID } from './config';
import { createMessage, getMessageStatus, reportBounce, reportReply } from './api-client';
import {
  getMsgIdForGmailMessage,
  getSettings,
  getTrackedThread,
  hasReportedBounce,
  hasReportedReply,
  markBounceReported,
  markReplyReported,
} from './storage';
import { recordSentMessage } from './sent-recording';
import { appendDepthBeacons, appendTrackingPixel, extractLinkUrls, rewriteLinks } from './html-injection';
import { formatRecipients } from './recipient-format';
import { describeStatus, statusIconDataUrl } from './status-chip';
import { extractBounceDetails, isBounceSender } from './bounce-detection';
import type { ComposeView, InboxSDKInstance, MessageView } from './inboxsdk-types';

export async function startMailTrack(): Promise<void> {
  const sdk = (await InboxSDKLoader.load(2, INBOXSDK_APP_ID)) as unknown as InboxSDKInstance;
  registerComposeTracking(sdk);
  registerStatusChips(sdk);
  registerBounceDetection(sdk);
  registerReplyDetection(sdk);
}

function registerComposeTracking(sdk: InboxSDKInstance): void {
  sdk.Compose.registerComposeViewHandler((composeView) => {
    let injectionAttempted = false;
    let trackedMsgId: string | null = null;
    // Captured at presending (recipients are final once the user hits send)
    // so the 'sent' handler can record the thread map for reply detection —
    // the compose view is gone by then, so getToRecipients() can't be called there.
    let trackedRecipientEmails: string[] = [];

    composeView.on('presending', (event) => {
      // InboxSDK's presending event isn't documented to await async
      // handlers, so the only reliable pattern is: cancel immediately, do
      // the async work, then call composeView.send() ourselves once done.
      // That resend may re-fire 'presending' — this guard makes the second
      // firing a pass-through instead of canceling again (NFR2: a tracking
      // bug must never be able to loop or silently eat the user's email).
      if (injectionAttempted) return;
      injectionAttempted = true;
      trackedRecipientEmails = composeView.getToRecipients().map((r) => r.emailAddress);
      event.cancel();

      injectTrackingThenSend(composeView).then((msgId) => {
        trackedMsgId = msgId;
      });
    });

    composeView.on('sent', (event) => {
      // ADR-25: getMessageID()/getThreadID() are async (Promise<string>) —
      // recordSentMessage awaits them. Doing it synchronously (the original
      // bug) stored a Promise as the map key and silently broke the status
      // chip and reply-thread correlation.
      if (!trackedMsgId) return; // tracking wasn't enabled or failed open untracked — nothing to record
      recordSentMessage(event, trackedMsgId, trackedRecipientEmails).catch(() => {});
    });
  });
}

/**
 * Returns the created msgId on success, or null if tracking was
 * skipped/failed (send still proceeds either way — NFR2). Every skip/fail
 * path logs to console.error: fail-open means never blocking or delaying
 * the send, it does NOT mean failing invisibly. A silent catch here was
 * previously indistinguishable from "nothing went wrong" — found live,
 * when a real user's tracked sends were silently failing with zero
 * diagnostic signal anywhere.
 */
async function injectTrackingThenSend(composeView: ComposeView): Promise<string | null> {
  let msgId: string | null = null;
  try {
    const settings = await getSettings();
    if (!settings.trackingEnabledByDefault || !settings.apiKey) {
      console.warn('[MailTrack] tracking skipped: not signed in or tracking disabled in options', {
        trackingEnabledByDefault: settings.trackingEnabledByDefault,
        hasApiKey: !!settings.apiKey,
      });
    } else {
      const html = composeView.getHTMLContent();
      const linkUrls = extractLinkUrls(html);
      const subject = composeView.getSubject();
      const recipient = formatRecipients(composeView.getToRecipients());
      const result = await createMessage(settings.apiKey, { linkUrls, subject, recipient, bodyLength: html.length }, COMPOSE_INJECTION_TIMEOUT_MS);
      let trackedHtml = appendTrackingPixel(rewriteLinks(html, result.linkMap), result.pixelUrl);
      if (result.beaconUrls) {
        // ADR-19: only present when the backend judged this body long enough
        // to plausibly hit Gmail's clip threshold — most sends won't have this.
        trackedHtml = appendDepthBeacons(trackedHtml, result.beaconUrls);
      }
      composeView.setBodyHTML(trackedHtml);
      msgId = result.msgId;
    }
  } catch (err) {
    // NFR2 fail-open: timeout, network error, or 4xx/5xx all fall through
    // to an untracked send below — the email always sends regardless. But
    // "fail open" only means don't block; it never meant fail silently.
    console.error('[MailTrack] tracking injection failed, email will send untracked:', err);
  } finally {
    try {
      composeView.send();
    } catch {
      // Compose view may have been destroyed (user closed the draft) between
      // cancel() and here; nothing more we can or should do.
    }
  }
  return msgId;
}

function registerStatusChips(sdk: InboxSDKInstance): void {
  sdk.Conversations.registerMessageViewHandlerAll(async (messageView) => {
    const settings = await getSettings();
    if (!settings.apiKey) return;

    const gmailMessageId = await messageView.getMessageIDAsync().catch(() => null);
    if (!gmailMessageId) return;

    const msgId = await getMsgIdForGmailMessage(gmailMessageId);
    if (!msgId) return; // not a message MailTrack sent — most messages in a thread are the recipient's own replies

    try {
      const { status } = await getMessageStatus(settings.apiKey, msgId);
      const { tooltip } = describeStatus(status);
      messageView.addAttachmentIcon({ iconUrl: statusIconDataUrl(status), tooltip });
    } catch {
      // A failed status fetch must never break Gmail's own UI; the chip just doesn't render this pass.
    }
  });
}

/**
 * ADR-20. Watches every message rendered in the sender's own inbox for
 * Gmail's own bounce-notification format and reports recognized ones to the
 * backend for correlation. Per MessageView's documented load lifecycle
 * (confirmed against the installed package's own .d.ts, not assumed):
 * getSender()/getBodyElement() can throw if called before the message has
 * loaded, which is common for collapsed messages in a thread — so this
 * checks isLoaded() first and falls back to the 'load' event rather than
 * calling those methods unconditionally.
 */
function registerBounceDetection(sdk: InboxSDKInstance): void {
  sdk.Conversations.registerMessageViewHandlerAll((messageView) => {
    if (messageView.isLoaded()) {
      handlePossibleBounce(messageView).catch(() => {});
    } else {
      messageView.on('load', ({ messageView: loaded }) => {
        handlePossibleBounce(loaded).catch(() => {});
      });
    }
  });
}

async function handlePossibleBounce(messageView: MessageView): Promise<void> {
  const settings = await getSettings();
  if (!settings.apiKey || !settings.bounceDetectionEnabled) return;

  let sender;
  try {
    sender = messageView.getSender();
  } catch {
    return; // isLoaded() raced with the actual load — the 'load' event (if this came from there) or a later render will retry
  }
  if (!isBounceSender(sender)) return; // the overwhelming majority of inbox messages, filtered out before any body text is ever read

  const gmailMessageId = await messageView.getMessageIDAsync().catch(() => null);
  if (!gmailMessageId || (await hasReportedBounce(gmailMessageId))) return;

  let bodyText: string;
  try {
    bodyText = messageView.getBodyElement().textContent ?? '';
  } catch {
    return;
  }

  const details = extractBounceDetails(bodyText);
  if (!details.recipientEmail) return; // sender matched mailer-daemon but this isn't a permanent-failure notice we recognize (e.g. a delay/retry notice) — never guess

  try {
    await reportBounce(settings.apiKey, {
      recipientEmail: details.recipientEmail,
      subjectExcerpt: details.subjectExcerpt ?? undefined,
      diagnostic: details.diagnostic ?? undefined,
      // MessageView exposes getDateString(), but it's locale-formatted prose,
      // not a reliably parseable timestamp — "now" (processing time) is an
      // honest approximation and the backend's correlation window (7 days)
      // already tolerates far more slack than this could ever introduce.
      bounceReceivedAt: new Date().toISOString(),
    });
    await markBounceReported(gmailMessageId);
  } catch (err) {
    console.error('[MailTrack] failed to report detected bounce:', err);
    // Deliberately NOT marking as reported on failure — worth retrying on the next render.
  }
}

/**
 * ADR-21. Watches every rendered message for a reply from the recipient in a
 * thread MailTrack sent to. A reply is the one signal that cannot be produced
 * by a background sync or an image proxy — it requires a human to author it —
 * so it's the strongest read-proof the product has. Deliberately reads only
 * the message's sender and thread ID (never its body text, unlike bounce
 * detection), so it needs no separate privacy toggle beyond being signed in.
 */
function registerReplyDetection(sdk: InboxSDKInstance): void {
  sdk.Conversations.registerMessageViewHandlerAll((messageView) => {
    if (messageView.isLoaded()) {
      handlePossibleReply(messageView).catch(() => {});
    } else {
      messageView.on('load', ({ messageView: loaded }) => {
        handlePossibleReply(loaded).catch(() => {});
      });
    }
  });
}

async function handlePossibleReply(messageView: MessageView): Promise<void> {
  const settings = await getSettings();
  if (!settings.apiKey) return;

  let threadId: string;
  try {
    threadId = await messageView.getThreadView().getThreadIDAsync();
  } catch {
    return;
  }
  const tracked = await getTrackedThread(threadId);
  if (!tracked) return; // not a thread MailTrack sent to — the vast majority of threads

  let sender;
  try {
    sender = messageView.getSender();
  } catch {
    return; // not loaded yet; a later render (or the 'load' event) retries
  }
  // A reply is a message FROM one of the original recipients. Our own sent
  // message and follow-ups have our address as sender (never in recipientEmails),
  // so they're correctly ignored — no need to know our own address separately.
  const senderEmail = sender.emailAddress.trim().toLowerCase();
  if (!tracked.recipientEmails.includes(senderEmail)) return;

  const replyGmailMessageId = await messageView.getMessageIDAsync().catch(() => null);
  if (!replyGmailMessageId || (await hasReportedReply(replyGmailMessageId))) return;

  try {
    await reportReply(settings.apiKey, { msgId: tracked.msgId, detectedAt: new Date().toISOString() });
    await markReplyReported(replyGmailMessageId);
  } catch (err) {
    console.error('[MailTrack] failed to report detected reply:', err);
    // Deliberately NOT marking as reported on failure — worth retrying on the next render.
  }
}
