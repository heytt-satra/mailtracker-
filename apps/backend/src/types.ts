export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
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
}

export interface Variables {
  userId: string;
}
