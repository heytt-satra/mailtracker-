import * as InboxSDKLoader from '@inboxsdk/core';
import { COMPOSE_INJECTION_TIMEOUT_MS, INBOXSDK_APP_ID } from './config';
import { createMessage, getMessageStatus } from './api-client';
import { getMsgIdForGmailMessage, getSettings, recordGmailMessageId } from './storage';
import { appendTrackingPixel, extractLinkUrls, rewriteLinks } from './html-injection';
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

/** Returns the created msgId on success, or null if tracking was skipped/failed (send still proceeds either way). */
async function injectTrackingThenSend(composeView: ComposeView): Promise<string | null> {
  let msgId: string | null = null;
  try {
    const settings = await getSettings();
    if (settings.trackingEnabledByDefault && settings.apiKey) {
      const html = composeView.getHTMLContent();
      const linkUrls = extractLinkUrls(html);
      const subject = composeView.getSubject();
      const result = await createMessage(settings.apiKey, { linkUrls, subject }, COMPOSE_INJECTION_TIMEOUT_MS);
      composeView.setBodyHTML(appendTrackingPixel(rewriteLinks(html, result.linkMap), result.pixelUrl));
      msgId = result.msgId;
    }
  } catch {
    // NFR2 fail-open: timeout, network error, or 4xx/5xx all fall through
    // to an untracked send below. Tracking must never be able to block mail.
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
