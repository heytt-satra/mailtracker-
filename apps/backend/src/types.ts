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
  /**
   * ADR-45. Replaces the old Cloudflare native Rate Limiting bindings —
   * those had their limit/period baked into wrangler.toml at deploy time
   * with no way to layer per-IP + per-account checks or exponential
   * backoff. One Durable Object class, addressed per rate-limit key (see
   * lib/rate-limit.ts::checkRateLimit) — see security notes in PLAN.md.
   */
  RATE_LIMITER_DO: DurableObjectNamespace;
  /**
   * ADR-45. Every threshold below is a plain wrangler.toml var (not a
   * secret) read via lib/rate-limit.ts::readRateLimitInt, which falls back
   * to a safe default if unset/malformed — "configurable, not hardcoded"
   * means retunable by editing wrangler.toml and redeploying, without
   * touching route code.
   */
  RATE_LIMIT_PUBLIC_PER_MIN?: string;
  RATE_LIMIT_USER_ACTIONS_PER_MIN?: string;
  RATE_LIMIT_WRITES_PER_MIN?: string;
  RATE_LIMIT_ATTACHMENTS_PER_MIN?: string;
  RATE_LIMIT_AUTH_IP_PER_MIN?: string;
  RATE_LIMIT_AUTH_ACCOUNT_PER_MIN?: string;
  RATE_LIMIT_ADMIN_PER_MIN?: string;
  RATE_LIMIT_WEBHOOK_PER_MIN?: string;
  /** ADR-59. Per-user throttle on the Safe Browsing check — separate from RATE_LIMIT_WRITES_PER_MIN since one send can check several URLs. */
  RATE_LIMIT_URL_REPUTATION_PER_MIN?: string;
  /** ADR-59. Safe Browsing's own quota is shared across the whole product, not per-user — this bucket protects it even if every user stays under their own per-user limit. */
  RATE_LIMIT_URL_REPUTATION_GLOBAL_PER_MIN?: string;
  /** ADR-36. 'test' | 'live' — selects test.dodopayments.com vs live.dodopayments.com. Defaults to 'test' (see routes/billing.ts) so a missing/unset var fails toward the sandbox, never accidentally live. */
  DODO_MODE?: string;
  /** Secret API key from the Dodo dashboard — set via `wrangler secret put DODO_API_KEY`, never committed. */
  DODO_API_KEY: string;
  /** Webhook signing secret from the Dodo dashboard's webhook registration — set via `wrangler secret put DODO_WEBHOOK_SECRET`. */
  DODO_WEBHOOK_SECRET: string;
  /** Product IDs, not secret — safe as plain wrangler.toml vars. */
  DODO_PRODUCT_ID_MONTHLY: string;
  DODO_PRODUCT_ID_YEARLY: string;
  /** ADR-42. Hosts uploaded PDFs for "Attach tracked PDF" — the link itself is tracked via the existing /l/:token click pipeline, not this bucket. */
  ATTACHMENTS_BUCKET: R2Bucket;
  /** ADR-44. Gates POST /v1/admin/grant-lifetime-subscriptions — a one-off internal action, not part of the public API surface, so it's a shared-secret header rather than a per-user API key. Set via `wrangler secret put ADMIN_SECRET`. */
  ADMIN_SECRET: string;
  /**
   * ADR-59. Google Safe Browsing Lookup API v4 key (Google Cloud Console —
   * enable "Safe Browsing API", create an API key). Optional: if unset,
   * lib/safe-browsing.ts::checkUrlsReputation fails open and every link
   * comes back unchecked (null), same as a network error or timeout — this
   * is a bonus safety signal, never a hard requirement for tracking to
   * work. Set via `wrangler secret put SAFE_BROWSING_API_KEY`.
   */
  SAFE_BROWSING_API_KEY?: string;
}

export interface Variables {
  userId: string;
}
