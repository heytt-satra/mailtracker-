// InboxSDK's content script asks the background service worker to inject
// its "page world" bridge script (public/pageWorld.js, copied at build time
// — see scripts/copy-pageworld.mjs and PLAN.md ADR-12) via a runtime
// message; this registers the listener that actually performs that
// injection (chrome.scripting.executeScript world:'MAIN'). Without it,
// InboxSDK never loads and the compose hook / status chips never run, with
// no visible error beyond "Couldn't inject pageWorld.js" in Gmail's own
// console — found live, via a real user's browser, not caught by any test.
import '@inboxsdk/core/background';
import { pollEvents } from '../src/api-client';
import { POLL_INTERVAL_MINUTES } from '../src/config';
import { getPollCursor, getSettings, setPollCursor } from '../src/storage';

const ALARM_NAME = 'mailtrack-poll';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      pollAndNotify().catch(() => {
        // A poll failure must never crash the service worker or surface to
        // the user — it just means notifications are stale until next tick.
      });
    }
  });
});

async function pollAndNotify(): Promise<void> {
  const settings = await getSettings();
  if (!settings.apiKey || !settings.notificationsEnabled) return;

  const since = await getPollCursor();
  const { polledAt, updates } = await pollEvents(settings.apiKey, since);

  for (const update of updates) {
    // Verdicts only escalate (PLAN.md ADR-5) — the backend never sends a
    // downgrade here, so every update in this list is safe to notify on.
    const verb = update.status === 'clicked' ? 'clicked a link in' : 'opened';
    chrome.notifications.create(`mailtrack-${update.msgId}-${update.status}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon-128.png'),
      title: 'MailTrack: verified',
      message: `Recipient ${verb} your tracked email.`,
      priority: 1,
    });
  }

  await setPollCursor(polledAt);
}
