// ADR-61 (Outlook add-in, C2). Same real, permanent-until-redeployed backend
// URL as apps/extension/src/config.ts — one backend serves both clients.
export const MAILTRACK_API_BASE_URL = import.meta.env.DEV ? 'http://localhost:8787' : 'https://mailtrack-api.heyttsatra17.workers.dev';

// Same Supabase project as the extension (apps/extension/src/config.ts) —
// one MailTrack account works across both clients. Public-safe by
// Supabase's own design; see the extension's config.ts for the full
// reasoning.
export const SUPABASE_URL = 'https://dsoymnodofvbedbjquuv.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Acb2i9J-QrtTJanPk3tV3A_S_lTWTdh';

// NFR2: tracking must never block or delay a send. Same value/reasoning as
// apps/extension/src/config.ts's COMPOSE_INJECTION_TIMEOUT_MS.
export const COMPOSE_INJECTION_TIMEOUT_MS = 4000;
