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

## 6. API Design

Base URL: `https://api.mailtrack.dev` (placeholder domain until purchased)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/v1/messages` | Register a new tracked send; returns `{msgId, pixelToken, linkToken}` | API key (per-install) |
| GET | `/p/:token.gif` | Tracking pixel. Always returns a 1x1 gif regardless of token validity (fail open, no errors leak state) | none (public) |
| GET | `/l/:token` | Click redirect. 302 to original URL, logs click event | none (public) |
| GET | `/v1/messages/:msgId/events` | Timeline of raw + classified events for a message | API key, owner-scoped |
| GET | `/v1/messages/:msgId/status` | Current verdict only (`sent\|delivered\|opened\|clicked\|not_verifiable`) | API key, owner-scoped |
| GET | `/v1/events/stream` | SSE stream of verdict upgrades for the authenticated user | API key, owner-scoped |
| DELETE | `/v1/messages/:msgId` | Delete tracking data for a message | API key, owner-scoped |
| GET | `/v1/messages/:msgId/export` | CSV export of event timeline | API key, owner-scoped |

All endpoints return JSON except `/p/*` (image/gif) and `/l/*` (302 redirect) and `/export` (text/csv).

## 7. Database Schema

```sql
-- users: one row per installed extension (v1 has no multi-seat orgs)
create table users (
  id uuid primary key default gen_random_uuid(),
  api_key_hash text not null unique,
  email text,
  created_at timestamptz not null default now()
);

-- messages: one row per tracked sent email
create table messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  gmail_message_id text,
  pixel_token text not null unique,
  subject_hash text,          -- hashed, not stored raw (privacy)
  sent_at timestamptz not null default now(),
  status text not null default 'sent'
    check (status in ('sent','delivered','opened','clicked','not_verifiable')),
  status_updated_at timestamptz not null default now()
);
create index idx_messages_pixel_token on messages(pixel_token);
create index idx_messages_user_id on messages(user_id);

-- link_tokens: one row per rewritten link in a message
create table link_tokens (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  token text not null unique,
  original_url text not null
);

-- raw_events: every fetch/click, unfiltered, append-only
create table raw_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  kind text not null check (kind in ('pixel_fetch','link_click')),
  occurred_at timestamptz not null default now(),
  user_agent text,
  ip_hash text not null,       -- IP hashed before storage (NFR4)
  asn integer,
  headers jsonb,
  fetch_sequence_ms integer    -- ms since sent_at, for timing filter
);
create index idx_raw_events_message_id on raw_events(message_id);

-- verdicts: classified, append-only, this is what drives notifications
create table verdicts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  raw_event_id uuid references raw_events(id),
  verdict text not null check (verdict in ('machine_suspect','verified_open','verified_click','not_verifiable')),
  reason text not null,        -- human-readable classifier rationale, shown in UI timeline
  created_at timestamptz not null default now()
);
create index idx_verdicts_message_id on verdicts(message_id);

-- asn_intel: refreshed weekly from MaxMind + published ranges
create table asn_intel (
  asn integer primary key,
  org_name text,
  category text not null check (category in ('apple_mpp','security_scanner','residential_isp','datacenter_other','unknown')),
  updated_at timestamptz not null default now()
);
```

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
- **Pixel/click handlers:** minimal, synchronous, no DB write on the hot path beyond a single fire-and-forget insert (`raw_events`) — never block the image response on classification.
- **Classifier:** runs out-of-band via a Cloudflare Queue consumer (or scheduled Worker cron as a fallback if Queues aren't provisioned) that reads new `raw_events` rows and writes `verdicts`.
- **IP intelligence refresh:** weekly scheduled Worker (`cron trigger`) pulls MaxMind GeoLite2-ASN snapshot + published Apple/Google/Microsoft/Proofpoint/Barracuda/Mimecast ranges, upserts `asn_intel`.
- **Data layer:** Supabase Postgres, accessed via `postgres.js` or Supabase's HTTP client (Workers can't hold raw TCP connections without Hyperdrive — **decision: use Supabase's REST/PostgREST interface or Cloudflare Hyperdrive**, documented as an open decision until Phase 1 implementation, see Known Issues).

## 10. Folder Structure

```
mailtrack/
  PLAN.md
  README.md
  apps/
    backend/
      src/
        index.ts            # Hono app entry
        routes/
          messages.ts
          pixel.ts
          click.ts
          events.ts
        classifier/
          rules.ts
          timing.ts
          useragent.ts
          asn.ts
          escalation.ts
        db/
          client.ts
          schema.sql
        types.ts
      tests/
        classifier.test.ts
        pixel.test.ts
        acceptance.regression.test.ts   # the mandatory phone regression test
      wrangler.toml
      package.json
    extension/
      (WXT project — scaffolded in Phase 2)
  packages/
    shared/
      src/
        types.ts             # shared types between extension + backend
  db/
    migrations/
  docs/
    engineering-journal.md
```

## 11. Development Roadmap & Milestones

- **M0 — Planning (this doc).** Done 2026-07-08.
- **M1 — Backend Phase 1:** pixel/click/messages endpoints, raw event logging, DB schema, unit tests. *(in progress)*
- **M2 — Classifier v1:** timing filter, UA fingerprint, ASN filter, escalation ladder, unit tests against fixtures.
- **M3 — Extension Phase 2:** WXT scaffold, InboxSDK compose hook, pixel/link injection, sent-status chip.
- **M4 — Notification loop:** SSE/poll background worker, desktop notifications, the mandatory phone acceptance test passing on a real device.
- **M5 — Dashboard/detail view + CSV export + delete-my-data.**
- **M6 — Hardening:** security review, performance benchmarks, ASN refresh cron, rate limiting.
- **M7 — Release:** Chrome Web Store listing, README, docs complete.

### Task Checklist (living — check off as completed)

- [x] PLAN.md created
- [x] Repo initialized and pushed
- [x] Monorepo folder structure
- [ ] Backend: Hono app skeleton + wrangler config
- [ ] Backend: POST /v1/messages
- [ ] Backend: GET /p/:token.gif
- [ ] Backend: GET /l/:token
- [ ] Backend: raw_events logging
- [ ] DB: schema.sql + migration applied to Supabase
- [ ] Classifier: timing filter
- [ ] Classifier: UA fingerprint
- [ ] Classifier: ASN filter
- [ ] Classifier: escalation ladder
- [ ] Classifier: unit tests against real-device fixtures
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

- [ ] All tokens (pixel, link, API key) are cryptographically random, ≥128 bits.
- [ ] API keys are stored hashed (never plaintext) — matches `users.api_key_hash`.
- [ ] IP addresses hashed at rest; raw IP never written to `raw_events` unhashed.
- [ ] Pixel/click endpoints rate-limited per token to prevent enumeration/abuse.
- [ ] CORS locked to the extension's origin for authenticated endpoints.
- [ ] No user-supplied data reflected unescaped (XSS) in any dashboard view.
- [ ] Redirect endpoint validates the stored `original_url` was the one registered at send time (no open-redirect via tampered tokens).
- [ ] Dependency audit (`npm audit` / `pnpm audit`) clean before release.
- [ ] Secrets (Supabase keys, MaxMind license) stored as Worker secrets, never committed.

## 14. Testing Strategy

- **Unit tests:** classifier rules in isolation (pure functions, fixture-driven) — fastest feedback loop, run on every commit.
- **Integration tests:** Hono routes against a test Supabase instance (or local Postgres via Docker) — verifies raw_events are written correctly and pixel/click handlers fail open.
- **E2E tests:** Playwright driving a real Gmail compose + send in a test account, verifying pixel/link injection actually lands in the sent message.
- **Regression tests:** see below — permanent, never removed.

## 15. Regression Tests (permanent)

1. **The mandatory phone acceptance test** (`acceptance.regression.test.ts`): send a tracked email to a real device inbox, confirm notification-preview-only fetch does NOT upgrade status past `delivered`, confirm actual open upgrades to `opened` (verified), confirm link click upgrades to `clicked`. This test requires a live device and is run manually per release until a device-farm harness exists; the assertions and fixture format are automated now so the harness can be swapped in later without rewriting the test.
2. Apple MPP fixture: pixel fetch from a known Apple private-relay ASN within 5s of send never escalates to `opened`.
3. Scanner-burst fixture: 10 resource fetches within 500ms of delivery never escalates past `delivered`.
4. Repeat-fetch fixture: pixel fetched once at delivery (machine pattern) then again 2 hours later (human pattern) escalates to `opened`.
5. Click-always-verifies fixture: any link click, regardless of prior pixel verdicts, escalates to `clicked`.
6. Verdict-never-downgrades fixture: once `opened`, a later `machine_suspect` classification does not revert status.

## 16. Known Issues / Open Decisions

- **DB connectivity from Workers:** Supabase direct Postgres connections don't work well from Workers' fetch-based runtime without Cloudflare Hyperdrive or PostgREST. Decision needed in Phase 1 implementation: use Supabase's PostgREST/JS client (simpler, slightly higher latency) vs. Hyperdrive (faster, requires paid Cloudflare plan). **Leaning PostgREST for v1** to stay on free tiers; revisit if latency goals aren't met.
- **Multi-recipient tracking:** Gmail sends one message body to all recipients on a thread; a single shared pixel cannot distinguish which recipient opened it. Documented as a v1 limitation, matches competitor behavior. Individual-send mode is a Phase 5+ future improvement.
- **Credentials required for real deployment, not yet provided:** Cloudflare account + Workers/Queues access, Supabase project URL + service key, MaxMind GeoLite2 license key, domain for the API. Code is being written against `.env`/Worker-secret placeholders so it is deploy-ready the moment these are supplied.
- **No `gh` CLI available in this environment** — GitHub operations use `git` directly over HTTPS with the credential manager already configured on this machine.

## 17. Technical Debt

- (none yet — will be logged here as shortcuts are taken, with the reason and a plan to resolve)

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
- Next: scaffold backend (Hono skeleton, pixel/click/messages routes, raw_events logging, DB schema file) and push as first commit milestone.
