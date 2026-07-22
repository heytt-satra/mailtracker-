/**
 * ADR-61 (Outlook add-in, C2). The on-send (`ItemSend`) handler — the
 * Outlook equivalent of apps/extension/src/inboxsdk-app.ts's
 * `injectTrackingThenResume`. Registered via `Office.actions.associate` and
 * wired to the `ItemSend` LaunchEvent in manifest.xml (SendMode="SoftBlock",
 * so if this add-in itself fails to load, Outlook still sends normally).
 *
 * NFR2 fail-open, same principle as the Gmail extension: every code path
 * below — success, any thrown error, a missing API key — ends in
 * `event.completed({ allowEvent: true })`. There is no path in this MVP
 * that blocks a send; unlike the extension's URL-reputation warning (B2),
 * that interactive-confirm pattern isn't ported here yet (see PLAN.md's
 * explicitly-out-of-scope list).
 */
import { createMessage, MailTrackApiError } from './api-client';
import { COMPOSE_INJECTION_TIMEOUT_MS } from './config';
import { appendDepthBeacons, appendTrackingPixel, extractLinkUrls, rewriteLinks } from './html-injection';
import { getSettings } from './storage';

Office.onReady(() => {
  // Nothing to do here — Office.actions.associate below registers the
  // handler independently of onReady; this call just confirms the host
  // finished initializing, logged for diagnostic visibility only.
  console.info('[MailTrack] function-file ready');
});

Office.actions.associate('onMessageSend', (event: Office.MailboxEvent) => {
  handleMessageSend(event).catch((err) => {
    // A throw escaping handleMessageSend's own try/catch would mean a bug in
    // this handler itself (not a tracking failure) — still fail open rather
    // than risk blocking the user's send over our own bug.
    console.error('[MailTrack] on-send handler crashed unexpectedly, sending untracked:', err);
    event.completed({ allowEvent: true });
  });
});

async function handleMessageSend(event: Office.MailboxEvent): Promise<void> {
  const settings = getSettings();
  const item = Office.context.mailbox.item as Office.MessageCompose | undefined;

  if (!settings.trackingEnabledByDefault || !settings.apiKey || !item) {
    console.warn('[MailTrack] tracking skipped: not signed in, tracking disabled, or no compose item available');
    event.completed({ allowEvent: true });
    return;
  }

  try {
    const html = await getBodyHtml(item);
    const linkUrls = extractLinkUrls(html);
    const subject = await getSubjectText(item);
    const recipient = await getRecipientSummary(item);

    const result = await createMessage(settings.apiKey, { linkUrls, subject, recipient, bodyLength: html.length }, COMPOSE_INJECTION_TIMEOUT_MS);

    let trackedHtml = appendTrackingPixel(rewriteLinks(html, result.linkMap), result.pixelUrl);
    if (result.beaconUrls) trackedHtml = appendDepthBeacons(trackedHtml, result.beaconUrls);
    await setBodyHtml(item, trackedHtml);
  } catch (err) {
    // NFR2 fail-open: timeout, network error, or 4xx/5xx all fall through
    // to an untracked send below — the email always sends regardless.
    if (err instanceof MailTrackApiError && err.status === 402) {
      console.warn('[MailTrack] tracking skipped: no active subscription. Email will send untracked.');
    } else {
      console.error('[MailTrack] tracking injection failed, email will send untracked:', err);
    }
  } finally {
    event.completed({ allowEvent: true });
  }
}

function getBodyHtml(item: Office.MessageCompose): Promise<string> {
  return new Promise((resolve, reject) => {
    item.body.getAsync(Office.CoercionType.Html, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
      else reject(result.error);
    });
  });
}

function setBodyHtml(item: Office.MessageCompose, html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    item.body.setAsync(html, { coercionType: Office.CoercionType.Html }, (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
      else reject(result.error);
    });
  });
}

function getSubjectText(item: Office.MessageCompose): Promise<string> {
  return new Promise((resolve, reject) => {
    item.subject.getAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value);
      else reject(result.error);
    });
  });
}

/** Same "primary dashboard identifier" role as the extension's formatRecipients — joins every To recipient's email address. */
function getRecipientSummary(item: Office.MessageCompose): Promise<string> {
  return new Promise((resolve, reject) => {
    item.to.getAsync((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve(result.value.map((recipient) => recipient.emailAddress).join(', '));
      } else {
        reject(result.error);
      }
    });
  });
}
