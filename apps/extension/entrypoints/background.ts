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
import { buildNotificationText } from '../src/notification-text';
import { getPollCursor, getSettings, setPollCursor } from '../src/storage';

const ALARM_NAME = 'mailtrack-poll';

export default defineBackground(() => {
  // ADR-30: creating the alarm ONLY inside onInstalled was the root cause of
  // notifications silently never working — onInstalled doesn't reliably fire
  // on every extension reload during dev (or, apparently, in some real
  // installs either), and if it's ever missed once, the alarm never gets
  // created and polling never starts, permanently. chrome.alarms.create()
  // with an existing name is a harmless no-op/reset, and this top-level call
  // runs every time the service worker initializes — on browser startup, on
  // extension reload, and whenever anything wakes it — so the alarm now
  // self-heals instead of depending on one specific lifecycle event firing.
  ensurePollAlarm();
  chrome.runtime.onInstalled.addListener(ensurePollAlarm);
  chrome.runtime.onStartup.addListener(ensurePollAlarm);

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      pollAndNotify().catch(() => {
        // A poll failure must never crash the service worker or surface to
        // the user — it just means notifications are stale until next tick.
      });
    }
  });

  // Clicking a notification takes you straight to the dashboard instead of
  // just disappearing — the notification exists to be acted on.
  chrome.notifications.onClicked.addListener((notificationId) => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    chrome.notifications.clear(notificationId);
  });
});

function ensurePollAlarm(): void {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
}

async function pollAndNotify(): Promise<void> {
  const settings = await getSettings();
  if (!settings.apiKey || !settings.notificationsEnabled) return;

  const since = await getPollCursor();
  const { polledAt, updates } = await pollEvents(settings.apiKey, since);

  for (const update of updates) {
    // Verdicts only escalate (PLAN.md ADR-5) — the backend never sends a
    // downgrade here, so every update in this list is safe to notify on.
    const { title, message } = buildNotificationText(update);
    chrome.notifications.create(`mailtrack-${update.msgId}-${update.event}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon-128.png'),
      title,
      message,
      priority: update.event === 'bounced' ? 2 : 1,
    });
  }

  await setPollCursor(polledAt);
}
