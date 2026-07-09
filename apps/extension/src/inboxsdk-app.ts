import * as InboxSDKLoader from '@inboxsdk/core';
import { COMPOSE_INJECTION_TIMEOUT_MS, INBOXSDK_APP_ID } from './config';
import { createMessage, getMessageStatus } from './api-client';
import { getMsgIdForGmailMessage, getSettings, recordGmailMessageId } from './storage';
import { appendTrackingPixel, extractLinkUrls, rewriteLinks } from './html-injection';
import { formatRecipients } from './recipient-format';
import { describeStatus, statusIconDataUrl } from './status-chip';
import type { ComposeView, InboxSDKInstance } from './inboxsdk-types';

export async function startMailTrack(): Promise<void> {
  const sdk = (await InboxSDKLoader.load(2, INBOXSDK_APP_ID)) as unknown as InboxSDKInstance;
  registerComposeTracking(sdk);
  registerStatusChips(sdk);
}

function registerComposeTracking(sdk: InboxSDKInstance): void {
  sdk.Compose.registerComposeViewHandler((composeView) => {
    let injectionAttempted = false;
    let trackedMsgId: string | null = null;

    composeView.on('presending', (event) => {
      // InboxSDK's presending event isn't documented to await async
      // handlers, so the only reliable pattern is: cancel immediately, do
      // the async work, then call composeView.send() ourselves once done.
      // That resend may re-fire 'presending' — this guard makes the second
      // firing a pass-through instead of canceling again (NFR2: a tracking
      // bug must never be able to loop or silently eat the user's email).
      if (injectionAttempted) return;
      injectionAttempted = true;
      event.cancel();

      injectTrackingThenSend(composeView).then((msgId) => {
        trackedMsgId = msgId;
      });
    });

    composeView.on('sent', (event) => {
      if (!trackedMsgId) return; // tracking wasn't enabled or failed open untracked — nothing to record
      const gmailMessageId = event.getMessageID();
      if (gmailMessageId) recordGmailMessageId(gmailMessageId, trackedMsgId).catch(() => {});
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
      const result = await createMessage(settings.apiKey, { linkUrls, subject, recipient }, COMPOSE_INJECTION_TIMEOUT_MS);
      composeView.setBodyHTML(appendTrackingPixel(rewriteLinks(html, result.linkMap), result.pixelUrl));
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
