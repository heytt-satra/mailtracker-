// Deployed 2026-07-08 to Cloudflare's workers.dev subdomain (no custom
// domain purchased yet — this is a real, permanent-until-redeployed URL,
// not a placeholder). During `wxt dev`, wrangler's default local port
// (8787) is used instead so the extension is testable against
// `wrangler dev` without editing this file.
export const MAILTRACK_API_BASE_URL = import.meta.env.DEV ? 'http://localhost:8787' : 'https://mailtrack-api.heyttsatra17.workers.dev';

// Registered at https://register.inboxsdk.com (2026-07-08).
export const INBOXSDK_APP_ID = 'sdk_Heytt_5a9ab5a6c4';

// Supabase project URL + publishable (anon) key — both public-safe by
// Supabase's own design (client apps are meant to embed this; access is
// enforced by RLS server-side, not by keeping it secret). Used ONLY for the
// signup/login screen's direct Supabase Auth calls (ADR-10) — never for
// direct table access, which always goes through the MailTrack API and its
// own api-key auth.
export const SUPABASE_URL = 'https://dsoymnodofvbedbjquuv.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Acb2i9J-QrtTJanPk3tV3A_S_lTWTdh';

// NFR2: tracking must never block or delay a send. If POST /v1/messages
// hasn't resolved by this deadline, the compose hook lets the email send
// untracked rather than waiting further.
export const COMPOSE_INJECTION_TIMEOUT_MS = 1500;

// Background worker poll cadence for /v1/events/poll. chrome.alarms clamps
// periodInMinutes to a 1-minute floor in packed extensions, so this is the
// fastest reliable cadence without relying on unpacked-only dev flags.
export const POLL_INTERVAL_MINUTES = 1;
