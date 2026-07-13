// InboxSDK's content script asks the background service worker to inject
// its "page world" bridge script (public/pageWorld.js, copied at build time
// — see scripts/copy-pageworld.mjs and PLAN.md ADR-12) via a runtime
// message; this registers the listener that actually performs that
// injection (chrome.scripting.executeScript world:'MAIN'). Without it,
// InboxSDK never loads and the compose hook / status chips never run, with
// no visible error beyond "Couldn't inject pageWorld.js" in Gmail's own
// console — found live, via a real user's browser, not caught by any test.
import '@inboxsdk/core/background';
import { listMessages, pollEvents } from '../src/api-client';
import { POLL_INTERVAL_MINUTES } from '../src/config';
import { getFollowUpSuggestion } from '../src/follow-up';
import { buildNotificationText } from '../src/notification-text';
import { getLastFollowUpNotifiedDate, getPollCursor, getSettings, setLastFollowUpNotifiedDate, setPollCursor, type MailTrackSettings } from '../src/storage';
import type { PollEventKind } from '@mailtrack/shared';

const ALARM_NAME = 'mailtrack-poll';
const FOLLOW_UP_ALARM_NAME = 'mailtrack-followup-check';
// Follow-up staleness only meaningfully changes day to day, unlike real-time
// opens/clicks — checking every 12h (rather than every POLL_INTERVAL_MINUTES)
// avoids burning API calls for a signal that can't have changed since the
// last check, while still catching the day-boundary promptly either way.
const FOLLOW_UP_CHECK_INTERVAL_MINUTES = 720;
// Safety cap so a very large tracked-message history can't turn this into an
// unbounded background loop — matches the same "no silent unbounded work"
// discipline as the rate limiters elsewhere in this project.
const MAX_FOLLOW_UP_PAGES = 20;

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
    } else if (alarm.name === FOLLOW_UP_ALARM_NAME) {
      checkFollowUpsAndNotify().catch(() => {
        // Same fail-open discipline as pollAndNotify: never crash the worker.
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
  chrome.alarms.create(FOLLOW_UP_ALARM_NAME, { periodInMinutes: FOLLOW_UP_CHECK_INTERVAL_MINUTES });
}

/** Maps each poll event kind to the specific settings toggle that gates it — all still subordinate to the master notificationsEnabled switch. */
const NOTIFY_TOGGLE_BY_EVENT: Record<PollEventKind, keyof MailTrackSettings> = {
  opened: 'notifyOnOpen',
  clicked: 'notifyOnClick',
  replied: 'notifyOnReply',
  bounced: 'notifyOnBounce',
  hot_conversation: 'notifyOnHotConversation',
  revival: 'notifyOnRevival',
};

async function pollAndNotify(): Promise<void> {
  const settings = await getSettings();
  if (!settings.apiKey || !settings.notificationsEnabled) return;

  const since = await getPollCursor();
  const { polledAt, updates } = await pollEvents(settings.apiKey, since);

  for (const update of updates) {
    if (!settings[NOTIFY_TOGGLE_BY_EVENT[update.event]]) continue;
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

/**
 * Follow-up reminders are computed, not tracked — derived entirely from
 * status/timestamps GET /v1/messages already returns, no new backend
 * endpoint (see src/follow-up.ts). Capped to one notification per calendar
 * day regardless of how often this alarm fires, since staleness only
 * meaningfully changes day to day and a notification every 12h for the same
 * unopened emails would just be noise.
 */
async function checkFollowUpsAndNotify(): Promise<void> {
  const settings = await getSettings();
  if (!settings.apiKey || !settings.notificationsEnabled || !settings.notifyOnFollowUp) return;

  const today = new Date().toISOString().slice(0, 10);
  if ((await getLastFollowUpNotifiedDate()) === today) return;

  const thresholds = { notOpenedDays: settings.followUpNotOpenedDays, openedNoReplyDays: settings.followUpOpenedNoReplyDays };
  const now = Date.now();
  let needsFollowUpCount = 0;
  let offset: number | null = 0;
  for (let page = 0; page < MAX_FOLLOW_UP_PAGES && offset !== null; page++) {
    const { messages, nextOffset } = await listMessages(settings.apiKey, offset);
    needsFollowUpCount += messages.filter((m) => getFollowUpSuggestion(m, now, thresholds) !== null).length;
    offset = nextOffset;
  }

  if (needsFollowUpCount === 0) return;

  chrome.notifications.create(`mailtrack-followup-${today}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon-128.png'),
    title: 'MailTrack: follow-ups waiting',
    message: `${needsFollowUpCount} tracked email${needsFollowUpCount === 1 ? '' : 's'} could use a follow-up — check the dashboard.`,
    priority: 1,
  });
  await setLastFollowUpNotifiedDate(today);
}
