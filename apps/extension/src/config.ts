// api.mailtrack.dev is a placeholder domain (PLAN.md Known Issues — no domain
// purchased, no Cloudflare/Supabase deployment yet). During `wxt dev`, wrangler's
// default local port (8787) is used instead so the extension is testable against
// `wrangler dev` without editing this file.
export const MAILTRACK_API_BASE_URL = import.meta.env.DEV ? 'http://localhost:8787' : 'https://api.mailtrack.dev';

// Free registration at https://register.inboxsdk.com — NOT YET OBTAINED. The
// Gmail integration will fail to load until this placeholder is replaced with
// a real registered App ID (see PLAN.md Known Issues). Left as an obvious
// placeholder rather than a silently-broken empty string so the failure mode
// is loud during development.
export const INBOXSDK_APP_ID = 'REPLACE_WITH_REGISTERED_INBOXSDK_APP_ID';

// NFR2: tracking must never block or delay a send. If POST /v1/messages
// hasn't resolved by this deadline, the compose hook lets the email send
// untracked rather than waiting further.
export const COMPOSE_INJECTION_TIMEOUT_MS = 1500;

// Background worker poll cadence for /v1/events/poll. chrome.alarms clamps
// periodInMinutes to a 1-minute floor in packed extensions, so this is the
// fastest reliable cadence without relying on unpacked-only dev flags.
export const POLL_INTERVAL_MINUTES = 1;
