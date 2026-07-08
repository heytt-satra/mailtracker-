export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  /** Public-safe by design (Supabase's client-side key, protected by RLS) — used only to validate a user-supplied access token via auth.getUser(jwt), never for privileged DB access. */
  SUPABASE_ANON_KEY: string;
  MAXMIND_LICENSE_KEY?: string;
  /**
   * chrome-extension://<id> — the real ID is only assigned once the
   * extension is loaded unpacked or published, so this can't be known until
   * then. Falls back to '*' (permissive) if unset, matching every other
   * "loud placeholder, not silently broken" decision in this codebase — see
   * PLAN.md Known Issues / security checklist.
   */
  ALLOWED_EXTENSION_ORIGIN?: string;
  /** Cloudflare native Rate Limiting bindings, declared in wrangler.toml — see security notes in PLAN.md section 13. */
  PUBLIC_RATE_LIMITER: RateLimit;
  MESSAGES_RATE_LIMITER: RateLimit;
  /** Keyed by IP — bounds signup/key-rotation abuse independent of any account. */
  AUTH_RATE_LIMITER: RateLimit;
}

export interface Variables {
  userId: string;
}
