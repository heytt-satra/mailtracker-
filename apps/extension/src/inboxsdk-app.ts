import * as InboxSDKLoader from '@inboxsdk/core';
import { COMPOSE_INJECTION_TIMEOUT_MS, INBOXSDK_APP_ID } from './config';
import { createMessage, getMessageStatus, MailTrackApiError, reportBounce, reportReply } from './api-client';
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
import type { ComposeView, Contact, InboxSDKInstance, MessageView } from './inboxsdk-types';

export async function startMailTrack(): Promise<void> {
  const sdk = (await InboxSDKLoader.load(2, INBOXSDK_APP_ID)) as unknown as InboxSDKInstance;
  registerComposeTracking(sdk);
  registerStatusChips(sdk);
  registerBounceDetection(sdk);
  registerReplyDetection(sdk);
}

function registerComposeTracking(sdk: InboxSDKInstance): void {
  sdk.Compose.registerComposeViewHandler((composeView) => {
    // Shared across BOTH the normal-send and schedule-send paths below —
    // exactly one of the two fires the real injection per compose session
    // (a user either clicks Send or opens the schedule menu, never both),
    // and this guard makes whichever fires SECOND (our own resumed
    // send()/openScheduleSendMenu() call re-firing the same event) a
    // pass-through instead of re-injecting or canceling again.
    let injectionAttempted = false;
    let trackedMsgId: string | null = null;
    // Captured at presending/scheduleSendMenuOpening (recipients are final
    // by then) so the 'sent' handler can record the thread map for reply
    // detection — the compose view is gone by the time 'sent' fires.
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
      const toRecipients = composeView.getToRecipients();
      trackedRecipientEmails = toRecipients.map((r) => r.emailAddress);
      event.cancel();

      (async () => {
        const settings = await getSettings();
        // ADR-40: mail merge is scoped to plain Send only, not the
        // schedule-send path — combining "split into N sends" with "each
        // gets its own schedule time" is a real design question (same time
        // for all? individually pickable?) left for a later pass rather
        // than guessed at here.
        if (settings.individualTrackingForGroupEmails && toRecipients.length > 1) {
          trackedMsgId = await sendIndividuallyToRecipients(sdk, composeView, toRecipients);
        } else {
          trackedMsgId = await injectTrackingThenResume(composeView, () => composeView.send());
        }
      })();
    });

    // ADR-38: `presending` never fires for Gmail's native "Schedule send" —
    // a known InboxSDK gap (github.com/InboxSDK/InboxSDK/issues/1243),
    // confirmed rather than assumed. Without this, a scheduled send skips
    // injection entirely and goes out completely untracked, silently.
    // `scheduleSendMenuOpening` is the real event InboxSDK fires when the
    // user opens the schedule date/time menu — same cancel-then-resume
    // shape as presending, resumed via openScheduleSendMenu() instead of
    // send() so the user still picks their own time normally afterward.
    composeView.on('scheduleSendMenuOpening', (event) => {
      if (injectionAttempted) return;
      injectionAttempted = true;
      trackedRecipientEmails = composeView.getToRecipients().map((r) => r.emailAddress);
      event.cancel();

      injectTrackingThenResume(composeView, () => composeView.openScheduleSendMenu()).then((msgId) => {
        trackedMsgId = msgId;
      });
    });

    composeView.on('sent', (event) => {
      // ADR-25: getMessageID()/getThreadID() are async (Promise<string>) —
      // recordSentMessage awaits them. Doing it synchronously (the original
      // bug) stored a Promise as the map key and silently broke the status
      // chip and reply-thread correlation.
      //
      // ADR-38: for a scheduled send, this compose view is long gone by the
      // time Gmail actually dispatches the message (hours/days later), so
      // 'sent' never fires for it — meaning the Gmail status chip and
      // reply-thread mapping don't work for scheduled sends, even though
      // opens/clicks/bounce detection do (those only need the pixel/link
      // tokens already baked into the body, not this event). A real,
      // smaller residual gap, not silently pretended away.
      console.info('[MailTrack] compose "sent" event fired; trackedMsgId =', trackedMsgId);
      if (!trackedMsgId) return; // tracking wasn't enabled or failed open untracked — nothing to record
      recordSentMessage(event, trackedMsgId, trackedRecipientEmails).catch(() => {});
    });
  });
}

/**
 * Returns the created msgId on success, or null if tracking was
 * skipped/failed (the resume action always proceeds either way — NFR2).
 * Every skip/fail path logs to console.error: fail-open means never
 * blocking or delaying the send, it does NOT mean failing invisibly. A
 * silent catch here was previously indistinguishable from "nothing went
 * wrong" — found live, when a real user's tracked sends were silently
 * failing with zero diagnostic signal anywhere.
 *
 * `resume` is `composeView.send()` for a normal send, or
 * `composeView.openScheduleSendMenu()` for a schedule send (ADR-38) — same
 * injection logic either way, just a different way of letting Gmail's own
 * flow continue afterward.
 */
async function injectTrackingThenResume(composeView: ComposeView, resume: () => void): Promise<string | null> {
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
    // ADR-36: a 402 specifically means "no active subscription" — worth its
    // own message so this doesn't look like a generic/transient failure.
    if (err instanceof MailTrackApiError && err.status === 402) {
      console.warn('[MailTrack] tracking skipped: no active subscription. Subscribe from the MailTrack options page to resume tracking. Email will send untracked.');
    } else {
      console.error('[MailTrack] tracking injection failed, email will send untracked:', err);
    }
  } finally {
    try {
      resume();
    } catch {
      // Compose view may have been destroyed (user closed the draft) between
      // cancel() and here; nothing more we can or should do.
    }
  }
  return msgId;
}

/** Small stagger between each split send — an unavoidable-by-nature client-side automation risk, but spacing them out looks less like a burst than firing all N back-to-back. */
const MAIL_MERGE_SEND_STAGGER_MS = 500;

/**
 * ADR-40 (mail merge). Splits one compose with N recipients into N separate
 * sends, each with its own tracked pixel/link tokens, so opens/clicks can
 * be attributed to a specific person instead of "someone in this group."
 * Built entirely on InboxSDK's own `openNewComposeView()` — confirmed
 * against the installed package's compose.d.ts — deliberately avoiding a
 * Gmail-API/OAuth-based approach, which would need a Google Cloud OAuth
 * consent screen and possibly Google's app-verification review, external
 * setup this project can't provision on its own (same category of blocker
 * as the Dodo Payments account issue).
 *
 * Returns the last created msgId (matches injectTrackingThenResume's
 * return shape for the caller), or null if nothing was tracked.
 */
async function sendIndividuallyToRecipients(sdk: InboxSDKInstance, firstComposeView: ComposeView, recipients: Contact[]): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.trackingEnabledByDefault || !settings.apiKey) {
    console.warn('[MailTrack] individual tracking skipped: not signed in or tracking disabled — sending as one untracked group email instead of splitting.');
    try {
      firstComposeView.send();
    } catch {
      // Compose view may have been destroyed between cancel() and here.
    }
    return null;
  }

  const subject = firstComposeView.getSubject();
  const originalHtml = firstComposeView.getHTMLContent();
  const linkUrls = extractLinkUrls(originalHtml);
  let lastMsgId: string | null = null;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i]!;
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, MAIL_MERGE_SEND_STAGGER_MS));

    try {
      const result = await createMessage(
        settings.apiKey,
        { linkUrls, subject, recipient: formatRecipients([recipient]), bodyLength: originalHtml.length },
        COMPOSE_INJECTION_TIMEOUT_MS,
      );
      let trackedHtml = appendTrackingPixel(rewriteLinks(originalHtml, result.linkMap), result.pixelUrl);
      if (result.beaconUrls) trackedHtml = appendDepthBeacons(trackedHtml, result.beaconUrls);
      lastMsgId = result.msgId;

      if (i === 0) {
        firstComposeView.setToRecipients([recipient.emailAddress]);
        firstComposeView.setBodyHTML(trackedHtml);
        firstComposeView.send();
      } else {
        const newComposeView = await sdk.Compose.openNewComposeView();
        newComposeView.setToRecipients([recipient.emailAddress]);
        newComposeView.setSubject(subject);
        newComposeView.setBodyHTML(trackedHtml);
        newComposeView.send();
      }
    } catch (err) {
      // NFR2 fail-open per recipient, not per whole batch — one recipient's
      // failure (e.g. a timeout) shouldn't silently drop the rest.
      console.error(`[MailTrack] individual-tracking send failed for recipient ${i + 1}/${recipients.length} (${recipient.emailAddress}):`, err);
      if (i === 0) {
        // The original compose view's body/recipients haven't been touched
        // yet in the failure path — send it untracked rather than lose it.
        try {
          firstComposeView.send();
        } catch {
          // Already destroyed; nothing more to do.
        }
      }
    }
  }

  return lastMsgId;
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

  // ADR-27: info-level (not debug, which Chrome hides) so the whole path is
  // visible during diagnosis. Fires for every rendered message — filter the
  // console by "MailTrack reply".
  let threadId: string;
  try {
    threadId = await messageView.getThreadView().getThreadIDAsync();
  } catch (err) {
    console.info('[MailTrack reply] a message rendered but its thread id was unavailable', err);
    return;
  }
  const tracked = await getTrackedThread(threadId);
  if (!tracked) {
    console.info('[MailTrack reply] rendered message in thread', threadId, '— not a tracked thread, ignoring');
    return;
  }

  let sender;
  try {
    sender = messageView.getSender();
  } catch (err) {
    console.info('[MailTrack reply] tracked thread', threadId, 'but sender not loaded yet; will retry', err);
    return; // not loaded yet; a later render (or the 'load' event) retries
  }
  // A reply is a message FROM one of the original recipients. Our own sent
  // message and follow-ups have our address as sender (never in recipientEmails),
  // so they're correctly ignored — no need to know our own address separately.
  const senderEmail = sender.emailAddress.trim().toLowerCase();
  const isReply = tracked.recipientEmails.includes(senderEmail);
  console.info('[MailTrack reply] tracked thread rendered:', {
    threadId,
    msgId: tracked.msgId,
    messageSender: senderEmail,
    trackedRecipients: tracked.recipientEmails,
    countsAsReply: isReply,
  });
  if (!isReply) return; // this rendered message is our own sent message, not the recipient's reply

  const replyGmailMessageId = await messageView.getMessageIDAsync().catch(() => null);
  if (!replyGmailMessageId || (await hasReportedReply(replyGmailMessageId))) return;

  try {
    await reportReply(settings.apiKey, { msgId: tracked.msgId, detectedAt: new Date().toISOString() });
    await markReplyReported(replyGmailMessageId);
    console.info('[MailTrack reply] ✓ reported reply for message', tracked.msgId);
  } catch (err) {
    console.error('[MailTrack reply] failed to report detected reply:', err);
    // Deliberately NOT marking as reported on failure — worth retrying on the next render.
  }
}
