# MailTrack — Living Project Plan

Status: **Active development** | Owner: Heytt Satra | Repo: https://github.com/heytt-satra/mailtracker-

This document is the single source of truth for MailTrack. It is updated after every meaningful change. Nothing is implemented before it is planned here first.

---

## 1. Executive Summary

MailTrack is a Gmail email-tracking Chrome extension and backend service that reports opens and clicks with **verified accuracy**. Every competitor in this space (Mailsuite, Mailtrack.io, Streak, Yesware) reports a "read" the instant a tracking pixel is fetched — but pixel fetches are triggered by Apple Mail Privacy Protection, notification-preview rendering, and corporate security scanners just as often as by an actual human opening the email. MailTrack's differentiator is a verification engine that classifies every pixel fetch before it is allowed to surface as a "read," and explicitly reports "not verifiable" rather than fabricating engagement when the signal is ambiguous.

## 2. Product Vision

Be the email tracker professionals trust because it tells the truth. Where competitors optimize for impressive-looking open rates, MailTrack optimizes for **decision-grade accuracy** — if it says "opened," the sender can act on that with confidence (follow up, escalate, close). No watermark on the free tier. No fabricated engagement, ever.

## 3. Product Requirements

### 3.1 Functional Requirements

- FR1: User can toggle tracking on/off per email from Gmail compose.
- FR2: Sent emails get an invisible pixel and rewritten trackable links, with no visible watermark or branding.
- FR3: Sent-folder thread view shows a per-email status indicator (Sent / Delivered / Opened / Clicked / Not verifiable).
- FR4: User receives a desktop notification only on verified-open or click events — never on raw pixel fetch.
- FR5: User can view a per-email event timeline showing all fetch events, with suppressed/non-human events visibly greyed out and labeled with the reason they were suppressed.
- FR6: Status only escalates: `Sent → Delivered → Opened (verified) → Clicked`. The system never downgrades or fabricates a status.
- FR7: When opens are structurally unverifiable for a recipient (e.g., detected Apple Mail Privacy Protection relay), the UI explicitly states this instead of showing a false positive or a silent blank.
- FR8: Click tracking redirects through MailTrack and preserves the original destination exactly.
- FR9: User can export event history as CSV.
- FR10: User can delete tracking data for a given sent message (privacy control).

### 3.2 Non-Functional Requirements

- NFR1 (Performance): Pixel endpoint p95 response time < 100ms globally (Cloudflare Workers edge).
- NFR2 (Reliability): No message send is ever blocked or delayed by tracking failure — tracking injection fails open (email sends untracked rather than not sending).
- NFR3 (Security): No tracking token is guessable; all tokens are cryptographically random (128-bit+). No PII beyond what Gmail already exposes is collected.
- NFR4 (Privacy): IP addresses are hashed at rest after ASN/geo classification is derived; raw IPs are not retained beyond 30 days.
- NFR5 (Maintainability): Backend and extension are independently deployable; classifier rules are unit-testable in isolation from the HTTP layer.
- NFR6 (Honesty): The false-positive rate on "Opened, verified" must be validated against real device tests (Phase 3) before any read notification ships to users.
- NFR7 (Scalability): Backend must handle burst traffic (scanner storms hitting the pixel endpoint within milliseconds of send) without degrading legitimate event processing.

### 3.3 User Stories

- As a founder emailing a prospect, I want to know the moment they actually read my email, not the moment their phone glances at it, so I can time my follow-up call correctly.
- As a salesperson, I want to trust my open rate numbers when reporting to my manager, so I don't get caught out by inflated metrics from prefetching.
- As a privacy-conscious user, I want to know when a recipient's platform makes tracking fundamentally impossible, instead of being shown a fake number.
- As a free-tier user, I don't want my emails to look like they came from a tracking tool.

## 4. Competitor Analysis

| Product | Open tracking method | Handles Apple MPP? | Free plan watermark | Notes |
|---|---|---|---|---|
| Mailsuite (Mailtrack) | Naive pixel, first-fetch = read | No — reports false opens | Yes ("Sent with Mailtrack") | The tool this project directly responds to |
| Yesware | Pixel + link tracking | Partial (flags "Apple device" but still counts open) | No (paid only) | Enterprise-focused, expensive |
| Streak | Pixel-based | No | No | CRM-first, tracking is secondary |
| Mailtrack.io | Pixel, double-check mark UI | No | Yes | Same false-positive problem as Mailsuite |

**Gap MailTrack fills:** nobody in this list classifies the fetch before reporting it. That is the entire product.

## 5. Technical Architecture

```
Gmail (web) ── Chrome Extension (MV3, WXT, InboxSDK) ── HTTPS ──▶ Cloudflare Worker (Hono)
                                                                        │
                                                        ┌───────────────┼────────────────┐
                                                        ▼               ▼                ▼
                                                 POST /messages   GET /p/:t.gif     GET /l/:t
                                                        │               │                │
                                                        └───────────────┴────────────────┘
                                                                        ▼
                                                          Supabase Postgres (raw events)
                                                                        ▼
                                                       Classifier (async, Worker cron / queue)
                                                                        ▼
                                                              verdicts table ──▶ /events (SSE/poll)
                                                                        ▼
                                                        Extension background worker ──▶ chrome.notifications
```

### Architecture Decisions (ADRs)

- **ADR-1: Cloudflare Workers over a VPS.** Chosen for global edge latency on the pixel endpoint (NFR1) and zero ops burden. Tradeoff: Workers' CPU-time limits mean the classifier runs as a separate async step (Cloudflare Queue consumer or cron trigger), not inline in the pixel handler. This is also *correct* behavior — the pixel response must never be slowed down by classification logic.
- **ADR-2: Supabase Postgres over a KV store.** Event data is relational (messages → events → verdicts) and needs ad-hoc querying for classifier tuning. Supabase gives Postgres + realtime + auth for free-tier scale.
- **ADR-3: InboxSDK over raw DOM scraping.** Gmail's DOM is unstable and obfuscated; InboxSDK is the de facto standard used by Streak, Mixmax, etc., and handles Gmail's SPA re-renders correctly.
- **ADR-4: No-cache pixel response.** `Cache-Control: no-store` on the pixel is required so repeat opens are observable — this is what makes the "verified" escalation ladder possible at all.
- **ADR-5: Verdicts only escalate, never downgrade or get deleted.** This is a product-integrity decision, not just an engineering one: it is the mechanism that makes "we don't fabricate engagement" true rather than aspirational.
- **ADR-6: ASN resolved from `request.cf.asn`, not a MaxMind mmdb lookup.** Cloudflare already resolves the requesting IP's ASN at the edge and exposes it on `request.cf.asn`/`asOrganization` for free — no GeoIP database needed in the hot path. This changes MaxMind's role from "resolve IP→ASN" (original plan) to "help build the `asn_intel` category mapping" (asn→apple_mpp/security_scanner/...), which is a strictly smaller and simpler job. Discovered during Phase 1 implementation; adopted because it removes an entire dependency (mmdb parsing in a Worker) for equivalent accuracy.
- **ADR-7: Polling over SSE for `/v1/events/*`.** True server-push on Cloudflare Workers needs a Durable Object to hold a connection open; without one, an SSE endpoint would be a half-working long-poll wearing an SSE label. Rather than ship that, v1 exposes `GET /v1/events/poll?since=<iso>` and the extension's background worker polls it every few seconds. Real push (Durable Objects, or Supabase Realtime consumed directly by the extension) is tracked in Future Improvements, not silently deferred.
- **ADR-8: Apple Mail Privacy Protection is detected by IP-range containment, not ASN.** Apple Private Relay's second hop can egress through third-party CDN partner ASNs, not just Apple's own — so an ASN→apple_mpp mapping risks misclassifying unrelated traffic that happens to share an ASN with a CDN partner (a false "not verifiable" for a real human, or worse, silently swallowed opens). Apple publishes an authoritative CSV of egress ranges at `mask-api.icloud.com/egress-ip-ranges.csv` (verified reachable during Phase 1 — response exceeds 10MB, consistent with a real, large, current range list). MailTrack stores these in a Postgres `ip_ranges` table and resolves membership via the native `inet <<= cidr` containment operator through a `classify_ip_category()` SQL function, checked before the ASN-based path in the classifier. `asn_intel` remains correct for security scanners, which do run dedicated ASNs.

## 6. API Design

Base URL: `https://api.mailtrack.dev` (placeholder domain until purchased)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/v1/messages` | Register a new tracked send; returns `{msgId, pixelToken, linkToken}` | API key (per-install) |
| GET | `/p/:token.gif` | Tracking pixel. Always returns a 1x1 gif regardless of token validity (fail open, no errors leak state) | none (public) |
| GET | `/l/:token` | Click redirect. 302 to original URL, logs click event | none (public) |
| GET | `/v1/messages/:msgId/events` | Timeline of raw + classified events for a message | API key, owner-scoped |
| GET | `/v1/messages/:msgId/status` | Current verdict only (`sent\|delivered\|opened\|clicked\|not_verifiable`) | API key, owner-scoped |
| GET | `/v1/events/poll?since=<iso>` | Verdict upgrades (opened/clicked) since a timestamp, across the user's messages — see ADR-7 (replaces the originally-planned SSE stream) | API key, owner-scoped |
| DELETE | `/v1/messages/:msgId` | Delete tracking data for a message | API key, owner-scoped |
| GET | `/v1/messages/:msgId/export` | CSV export of event timeline | API key, owner-scoped |

All endpoints return JSON except `/p/*` (image/gif) and `/l/*` (302 redirect) and `/export` (text/csv).

## 7. Database Schema

Canonical, executable source: [`db/migrations/0001_init.sql`](./db/migrations/0001_init.sql) — this section is a summary, not a duplicate; if they ever disagree, the migration file wins.

- `users` — one row per installed extension (v1 has no multi-seat orgs). `api_key_hash` only, never plaintext.
- `messages` — one row per tracked send. `status` is the escalate-only ladder value (`sent|delivered|opened|clicked|not_verifiable`), `pixel_token` is the unique 128-bit token embedded in the pixel URL.
- `link_tokens` — one row per rewritten link in a message, maps `token → original_url`.
- `raw_events` — every fetch/click, unfiltered, append-only. Carries `ip_hash` (never raw IP, NFR4), `asn` (from `request.cf.asn`, ADR-6), `ip_category` (resolved inline at log time via `classify_ip_category()`, ADR-8), and `classified_at` (null until the cron sweep processes it — lets the sweep cheaply select the pending queue).
- `verdicts` — classified, append-only; this is what drives status changes and notifications. Carries a human-readable `reason` shown directly in the UI timeline.
- `asn_intel` — `asn → category` mapping for security-scanner ASNs (Proofpoint/Mimecast/Barracuda/etc). Populated from verified vendor documentation, never guessed (see Known Issues).
- `ip_ranges` — `cidr → category` mapping, currently Apple Private Relay egress ranges refreshed weekly from Apple's published CSV. Queried via the native `inet <<= cidr` containment operator wrapped in `classify_ip_category(inet) returns text`, longest-prefix-match wins (ADR-8).
- RLS is enabled with no policies on every table as defense-in-depth — these tables are only ever touched with the service-role key, never the anon key.

## 8. Chrome Extension Architecture

- **Framework:** WXT (Vite-based MV3 tooling) + TypeScript.
- **Gmail integration:** InboxSDK, loaded via content script into Gmail's page.
- **Compose hook:** `InboxSDK.Compose.registerComposeViewHandler` — adds a tracking toggle button; on send, calls backend `POST /v1/messages`, injects pixel `<img>` + rewrites `<a href>` tags in the compose body before InboxSDK's `send` event finalizes.
- **Thread view hook:** `InboxSDK.Conversations` — injects a status chip (Sent/Delivered/Opened/Clicked/Not verifiable) next to tracked messages in the Sent view.
- **Background service worker:** polls `/v1/events/stream` (SSE) or falls back to short-interval polling; on a `verified_open` or `verified_click` verdict, fires `chrome.notifications.create`.
- **Options page:** default tracking on/off, notification preferences, API key / account, CSV export, "delete my data."
- **Fail-open guarantee:** if the backend call in the compose hook fails or times out (>1.5s), the extension lets the email send untracked rather than blocking send (NFR2).

## 9. Backend Architecture

- **Runtime:** Cloudflare Workers, `Hono` router.
- **Pixel handler (`/p/:token.gif`):** returns a static 43-byte GIF synchronously, identical regardless of token validity (no enumeration signal). All DB work — token lookup, IP-range/ASN resolution, `raw_events` insert — runs in `ctx.waitUntil()` after the response is already flushed, so it can never add latency to the image fetch (ADR-1, NFR1).
- **Click handler (`/l/:token`):** must resolve the token before it can redirect (no safe fallback), so that one lookup is on the hot path; the `raw_events` insert itself still runs in `waitUntil()`.
- **Classifier sweep:** scheduled Worker cron (`* * * * *`, every minute) reads `raw_events where classified_at is null`, resolves prior-fetch context (first-fetch / burst count) and ASN/IP-range intel, calls the pure `classifyEvent()` function, writes a `verdicts` row, and advances `messages.status` through the escalate-only ladder. Queues would allow lower latency but require a paid Cloudflare plan; documented as a revisit if the 1-minute cron's ~60s worst-case classification lag ever fails NFR7 in practice.
- **Intel refresh:** weekly scheduled Worker (`0 3 * * 1`) re-downloads Apple's published egress-range CSV into `ip_ranges`. Security-scanner ASN data (`asn_intel`) is written by a separate, manually-invoked upsert path — no data ships until it's sourced from verified vendor docs (see Known Issues).
- **Data layer:** `@supabase/supabase-js`, which is fetch-based and works natively in Workers — no Hyperdrive or raw TCP connection needed (resolves the open decision from the original plan).

## 10. Folder Structure

```
mailtrack/
  PLAN.md
  README.md
  package.json           # npm workspaces root
  apps/
    backend/              # implemented, M1 complete
      src/
        index.ts           # Hono app entry + scheduled() cron dispatcher
        types.ts            # Env bindings (Cloudflare secrets/vars)
        routes/
          messages.ts        # POST /v1/messages
          pixel.ts            # GET /p/:token.gif
          click.ts            # GET /l/:token
          events.ts           # status/events/export/delete/poll
        middleware/
          auth.ts             # API key -> userId
        classifier/
          rules.ts            # classifyEvent() — the core differentiator
          timing.ts
          useragent.ts
          asn.ts
          escalation.ts       # the escalate-only ladder
          sweep.ts            # cron: unclassified raw_events -> verdicts
          intel-refresh.ts    # cron: Apple egress-range refresh
        db/
          client.ts
        lib/
          crypto.ts           # token generation, SHA-256
          cf.ts                # request.cf.asn reader (ADR-6)
      tests/
        classifier.test.ts   # 22 tests incl. all 6 permanent regression fixtures
      wrangler.toml
      package.json
      tsconfig.json
      vitest.config.ts
    extension/              # not yet started — Phase 2 (M3)
  packages/
    shared/
      src/
        types.ts             # shared types between extension + backend
  db/
    migrations/
      0001_init.sql          # canonical schema, keep in sync with section 7
```

## 11. Development Roadmap & Milestones

- **M0 — Planning (this doc).** Done 2026-07-08.
- **M1 — Backend Phase 1:** pixel/click/messages endpoints, raw event logging, DB schema, unit tests. **Code complete 2026-07-08.** Not yet deployed (no Supabase/Cloudflare credentials) — see Known Issues.
- **M2 — Classifier v1:** timing filter, UA fingerprint, ASN filter, IP-range filter, escalation ladder, unit tests against fixtures. **Code complete 2026-07-08** (22/22 tests passing incl. all 6 permanent regression fixtures). Tuning against real-device data still pending deployment.
- **M3 — Extension Phase 2:** WXT scaffold, InboxSDK compose hook, pixel/link injection, sent-status chip.
- **M4 — Notification loop:** SSE/poll background worker, desktop notifications, the mandatory phone acceptance test passing on a real device.
- **M5 — Dashboard/detail view + CSV export + delete-my-data.**
- **M6 — Hardening:** security review, performance benchmarks, ASN refresh cron, rate limiting.
- **M7 — Release:** Chrome Web Store listing, README, docs complete.

### Task Checklist (living — check off as completed)

- [x] PLAN.md created
- [x] Repo initialized and pushed
- [x] Monorepo folder structure
- [x] Backend: Hono app skeleton + wrangler config
- [x] Backend: POST /v1/messages
- [x] Backend: GET /p/:token.gif
- [x] Backend: GET /l/:token
- [x] Backend: raw_events logging (incl. IP-range + ASN dual signal, ADR-8)
- [x] Backend: classifier sweep cron + intel refresh cron wired into index.ts
- [x] DB: schema.sql written (`db/migrations/0001_init.sql`) — **not yet applied**, no Supabase project provisioned (see Known Issues)
- [x] Classifier: timing filter
- [x] Classifier: UA fingerprint
- [x] Classifier: ASN filter
- [x] Classifier: IP-range filter (Apple Private Relay, ADR-8)
- [x] Classifier: escalation ladder
- [x] Classifier: unit tests — 22 tests passing, including all 6 permanent regression fixtures from section 15
- [ ] Classifier: tuning pass against real-device fixtures (needs a deployed backend + real sends, blocked on credentials)
- [ ] Backend: integration tests against a live Supabase instance (blocked on credentials)
- [ ] Extension: WXT scaffold
- [ ] Extension: InboxSDK compose hook + pixel/link injection
- [ ] Extension: sent-status chip
- [ ] Extension: background notification worker
- [ ] Regression test: phone acceptance test automated
- [ ] Security review
- [ ] Performance benchmark (p95 < 100ms)
- [ ] Chrome Web Store listing

## 12. Performance Goals

- Pixel endpoint p95 < 100ms, p99 < 250ms (edge, cold-start excluded).
- Compose-hook injection adds < 200ms perceived latency to Gmail's native send action.
- Classifier lag (fetch → verdict available) < 5s p95, so notifications feel real-time.

## 13. Security Checklist

- [x] All tokens (pixel, link, API key) are cryptographically random, ≥128 bits (`lib/crypto.ts::randomToken`, 16 bytes via `crypto.getRandomValues`).
- [x] API keys are stored hashed (never plaintext) — matches `users.api_key_hash`, SHA-256 via Web Crypto.
- [x] IP addresses hashed at rest; raw IP never written to `raw_events` unhashed (`ip_hash` column, raw IP only touched transiently in the pixel/click handler to derive `ip_category` and the hash).
- [ ] Pixel/click endpoints rate-limited per token to prevent enumeration/abuse. **Not yet implemented** — needs Cloudflare rate limiting rules or a Worker-side token-bucket in KV; tracked for M6.
- [ ] CORS locked to the extension's origin for authenticated endpoints. **Not yet implemented** — needs the actual extension ID, which doesn't exist until the extension is published/loaded unpacked; tracked for M3.
- [ ] No user-supplied data reflected unescaped (XSS) in any dashboard view. N/A yet — no dashboard UI built (M5).
- [x] Redirect endpoint only ever redirects to `original_url` looked up server-side by token; there is no client-supplied URL parameter, so open-redirect via tampering is structurally not possible.
- [ ] Dependency audit clean before release. `npm audit` currently reports 9 vulnerabilities (5 moderate/3 high/1 critical) in `wrangler`'s transitive dev dependencies — not in shipped runtime code. Deferred to before M7 release; re-audit then since `wrangler` ships frequent patches.
- [x] Secrets (Supabase keys, MaxMind license) referenced only via `Env` bindings / `wrangler secret put`, never present in any committed file — verified via `.gitignore` (`.env*`) and `wrangler.toml` containing only non-secret `[vars]`.

## 14. Testing Strategy

- **Unit tests:** classifier rules in isolation (pure functions, fixture-driven) — fastest feedback loop, run on every commit.
- **Integration tests:** Hono routes against a test Supabase instance (or local Postgres via Docker) — verifies raw_events are written correctly and pixel/click handlers fail open.
- **E2E tests:** Playwright driving a real Gmail compose + send in a test account, verifying pixel/link injection actually lands in the sent message.
- **Regression tests:** see below — permanent, never removed.

## 15. Regression Tests (permanent)

Two tiers: a manual live-device test that is the ultimate source of truth, and an automated unit suite (`apps/backend/tests/classifier.test.ts`, `describe('regression: permanent fixtures')`) that exercises the same six scenarios against the pure classifier functions on every commit. The unit suite passes today (22/22); the live-device test can't run until the backend is deployed (see Known Issues) but its steps are specified now so it's ready the moment deployment credentials exist.

1. **The mandatory phone acceptance test (manual, live device):** send a tracked email to a real device inbox, confirm notification-preview-only fetch does NOT upgrade status past `delivered`, confirm actual open upgrades to `opened` (verified), confirm link click upgrades to `clicked`. Run per release until a device-farm harness exists. Unit-level proxy: `classifier.test.ts` fixture 1.
2. Apple MPP fixture: pixel fetch from a known Apple Private Relay egress range within 5s of send never escalates to `opened` (now IP-range based per ADR-8, plus an ASN-based fallback fixture).
3. Scanner-burst fixture: 10 resource fetches within 500ms of delivery never escalates past `delivered`.
4. Repeat-fetch fixture: pixel fetched once at delivery (machine pattern) then again 2 hours later (human pattern) escalates to `opened`.
5. Click-always-verifies fixture: any link click, regardless of prior pixel verdicts (even from an Apple MPP range), escalates to `clicked`.
6. Verdict-never-downgrades fixture: once `opened`, a later `machine_suspect` classification does not revert status.

## 16. Known Issues / Open Decisions

- **DB connectivity from Workers: resolved.** `@supabase/supabase-js` is fetch-based and works natively in Workers; no Hyperdrive needed (ADR/decision closed during Phase 1, see section 9).
- **Multi-recipient tracking:** Gmail sends one message body to all recipients on a thread; a single shared pixel cannot distinguish which recipient opened it. Documented as a v1 limitation, matches competitor behavior. Individual-send mode is a Phase 5+ future improvement.
- **Credentials required for real deployment, not yet provided:** Cloudflare account + Workers access, Supabase project URL + service key. Code is fully written against `Env` placeholders (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MAXMIND_LICENSE_KEY`) and is deploy-ready the moment `wrangler login` + `wrangler secret put` are run with real values. **This blocks:** applying `db/migrations/0001_init.sql` to a real database, running `wrangler dev`/`deploy`, and the live-device acceptance test.
- **MaxMind GeoLite2-ASN integration deferred, not implemented.** The original plan used MaxMind to resolve IP→ASN; ADR-6 made that unnecessary (Cloudflare gives ASN for free via `request.cf.asn`). MaxMind's remaining potential use — bulk-sourcing the `asn_intel` security-scanner category mapping — needs the GeoLite2-ASN-CSV feed, which ships as a `.zip` requiring a zip-parsing dependency not yet added. Scanner ASN rows must currently be entered manually from verified vendor documentation via `upsertAsnIntel()`; shipping guessed ASN numbers was rejected as too risky (a wrong number silently suppresses real opens — the exact failure this product exists to prevent). `MAXMIND_LICENSE_KEY` remains in `Env` for when this is built out.
- **Apple egress-range endpoint verified reachable but not yet ingested into a real database** (no Supabase project to upsert into yet). `refreshAppleRelayRanges()` is implemented and will run on first successful cron trigger once deployed.
- **No `gh` CLI available in this environment** — GitHub operations use `git` directly over HTTPS with the credential manager already configured on this machine.

## 17. Technical Debt

- `npm audit` reports 9 vulnerabilities (5 moderate, 3 high, 1 critical), all in `wrangler`'s transitive dev dependencies (not in shipped Worker code). Plan: re-audit and update `wrangler` immediately before M7 release rather than chasing upstream patches mid-development.
- `asn_intel` ships with zero seed rows (see Known Issues) — the security-scanner detection branch of the classifier is implemented and tested but has no real data to act on until rows are sourced. Not a code defect, but means M2's "tuning against real fixtures" milestone has a hard dependency on this being populated first.

## 18. Release Checklist

- [ ] All M1–M6 milestones complete
- [ ] All regression tests passing, including the live-device acceptance test
- [ ] Security checklist fully checked
- [ ] Performance goals met and benchmarked
- [ ] README complete with setup instructions
- [ ] PLAN.md fully reflects shipped state, no stale checklist items
- [ ] Chrome Web Store listing submitted

## 19. Future Improvements

- Individual-send mode (unique pixel per recipient) for accurate multi-recipient tracking.
- Follow-up reminders ("not opened in N days").
- Outlook/other mail client support.
- Lensr Ops integration for outreach campaign tracking.
- Team/org accounts with shared visibility.

## 20. Daily Engineering Journal

### 2026-07-08

- Initial conversational plan drafted, then formalized into this full PLAN.md per the project's mandatory planning-first workflow.
- Root-caused the false-open problem: Apple Mail Privacy Protection, notification prefetching, and security scanners all fetch tracking pixels without human involvement — competitors treat every fetch as a read, we will not.
- Verified environment: no `gh` CLI available; `git` credential manager is configured and authenticated; target repo `heytt-satra/mailtracker-` exists and is empty and reachable.
- Decided architecture: Cloudflare Workers + Hono backend, Supabase Postgres, WXT + InboxSDK extension. Verdicts escalate-only ladder is both a technical and product-integrity mechanism.
- Flagged that real deployment (Cloudflare, Supabase, MaxMind) needs credentials not yet available in this environment; proceeding with deploy-ready scaffolding against env placeholders so no work is blocked.
- Initialized git, pushed first commit (README + .gitignore + PLAN.md) to `heytt-satra/mailtracker-`.
- Built the full M1/M2 backend: npm-workspaces monorepo (`@mailtrack/shared`, `@mailtrack/backend`), Hono app on Cloudflare Workers, `POST /v1/messages`, `GET /p/:token.gif`, `GET /l/:token`, status/timeline/export/delete/poll routes, API-key auth middleware.
- Built the classifier (`rules.ts` + `timing.ts` + `useragent.ts` + `asn.ts` + `escalation.ts`) as pure, DB-free functions and wrote 22 unit tests, including all 6 permanent regression fixtures from section 15. All passing. `tsc --noEmit` clean across the backend.
- Mid-build correctness fix: caught that Apple Private Relay egress doesn't reliably map to a single ASN (it can ride third-party CDN partner ASNs), which would have made a pure ASN-based `apple_mpp` check misclassify unrelated traffic. Verified Apple's published egress-range CSV is real and reachable (`mask-api.icloud.com/egress-ip-ranges.csv`, response >10MB) and switched Apple MPP detection to IP-range containment via a Postgres `classify_ip_category()` function (ADR-8), keeping ASN-based detection only for security scanners where it's actually reliable.
- Two other architecture corrections made and documented as ADRs rather than left as silent decisions: ADR-6 (Cloudflare's `request.cf.asn` replaces MaxMind for IP→ASN resolution — MaxMind's role shrinks to sourcing the scanner-ASN category list) and ADR-7 (polling endpoint instead of a half-working SSE stream, since real server push needs a Durable Object).
- Deliberately did NOT seed `asn_intel` with guessed scanner ASN numbers — wrong numbers would silently suppress real opens, which is the exact failure mode this product exists to prevent. Documented as a blocker requiring verified vendor data.
- Committed and pushed the M1/M2 backend milestone.
- Next: Phase 2 — WXT extension scaffold, InboxSDK compose hook, pixel/link injection into Gmail sends.
