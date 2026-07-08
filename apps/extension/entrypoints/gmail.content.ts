import { startMailTrack } from '../src/inboxsdk-app';

export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  main() {
    startMailTrack().catch((err) => {
      // NFR2 fail-open extends to the integration itself: if InboxSDK fails
      // to load (e.g. missing/invalid App ID — see PLAN.md Known Issues),
      // Gmail must keep working normally. Log for the user to notice via
      // devtools rather than silently doing nothing forever.
      console.error('[MailTrack] failed to start Gmail integration:', err);
    });
  },
});
