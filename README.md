# mailtracker-

MailTrack — a Gmail email tracker that reports **verified** opens instead of every pixel fetch.

Most trackers (Mailsuite, Mailtrack.io) mark an email "read" the instant the tracking pixel is fetched — which happens constantly from Apple Mail Privacy Protection, phone notification previews, and corporate security scanners, none of which involve a human reading anything. MailTrack classifies every fetch (timing, user-agent, ASN/IP intelligence, fetch behavior) before it's allowed to escalate a message's status, and says "not verifiable" instead of lying when it can't tell.

Status: **Live.** Backend deployed at `https://mailtrack-api.heyttsatra17.workers.dev`, database migrated, extension configured against production. See [PLAN.md](./PLAN.md) for the full spec, architecture, schema, roadmap, and engineering journal — it is the living source of truth for this project.

## Monorepo layout

```
apps/backend/    Cloudflare Workers + Hono API (pixel, click, messages, classifier)
apps/extension/  Chrome MV3 extension (WXT + InboxSDK) — Gmail compose/thread integration
packages/shared/ Types shared between backend and extension
db/migrations/   Supabase Postgres schema
docs/            Engineering docs
```

## Core guarantee

Verdicts only escalate: `Sent → Delivered → Opened (verified) → Clicked`. Never fabricated, never downgraded.

## Status

Backend, extension, dashboard, and self-serve auth are all code-complete, typechecked, unit-tested (58 tests total), and — as of 2026-07-08 — deployed. The backend is live and smoke-tested against production (pixel/click/auth endpoints all verified to behave correctly). The one remaining step is loading the extension into a real Chrome profile and completing signup, which requires clicking a real email confirmation link — see "Loading the extension" below. The sections below are also the general runbook if you're setting this up fresh with your own accounts.

## Local development (no external accounts needed)

```bash
npm install                                    # installs all three workspaces
npm run test --workspace=apps/backend          # 27 tests
npm run test --workspace=apps/extension        # 31 tests
npm run typecheck --workspace=apps/backend     # or cd into either app and run directly
npm run typecheck --workspace=apps/extension
cd apps/extension && npx wxt build             # produces .output/chrome-mv3, a loadable (if not yet InboxSDK/Supabase-functional) extension
```

## Deploying the backend

_Already done for this instance — steps below are for redeploying or setting up a fresh instance._

1. **Cloudflare account.** `cd apps/backend && npx wrangler login` (interactive OAuth — needs a real browser). An API token (dash.cloudflare.com/profile/api-tokens, "Edit Cloudflare Workers" template) works too via `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` env vars, for non-interactive/headless deploys.
2. **Supabase project.** Create one at supabase.com, then run `db/migrations/0001_init.sql` against it (SQL editor, or `supabase db push` if using the Supabase CLI). Supabase Auth (email+password) is on by default — no extra setup needed for that part.
3. **Set Worker secrets** (never put these in `wrangler.toml`, which is committed):
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_KEY   # the service_role key — the Worker needs to bypass RLS (see PLAN.md section 7)
   npx wrangler secret put SUPABASE_ANON_KEY      # public-safe client key, used only to validate signed-in users' tokens (ADR-10)
   ```
4. **Deploy:** `npx wrangler deploy` (requires wrangler ≥4 — the `[[ratelimits]]` config in `wrangler.toml` silently isn't recognized by wrangler 3.x, which will warn "Unexpected fields" instead of erroring; `package.json` already pins `^4.0.0` so a plain `npm install` gets the right version). This also registers the two cron triggers (classifier sweep, Apple relay range refresh) and the rate-limiting bindings — no extra provisioning needed for those, they're declarative. Run `wrangler deploy --dry-run` first if you want to confirm the bindings list before going live.
5. **Update `apps/extension/src/config.ts`** — `MAILTRACK_API_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` — with your deployed Worker's URL and Supabase project's public values, and `apps/extension/wxt.config.ts`'s `host_permissions` to match if you're not using Supabase's standard `*.supabase.co` domain.

## Loading the extension

_InboxSDK App ID and Supabase config are already wired in for this instance — start at step 2 if you're just loading it locally._

1. **Register a free InboxSDK App ID** at register.inboxsdk.com (a couple of minutes, requires a Google account — this is a *developer* credential for the Gmail integration, unrelated to any end-user login). Replace the placeholder in `apps/extension/src/config.ts::INBOXSDK_APP_ID`.
2. `cd apps/extension && npx wxt build`.
3. In Chrome, go to `chrome://extensions`, enable Developer Mode, "Load unpacked", select `apps/extension/.output/chrome-mv3`.
4. Open the extension's options page (right-click its toolbar icon → Options). Sign up with an email + password — this calls Supabase Auth directly and exchanges the resulting session for a MailTrack API key automatically (ADR-10). No manual key handling needed; the "Advanced: enter an API key manually" fallback is there for troubleshooting only.
5. Open Gmail, compose and send a test email — the compose hook should inject tracking transparently (fails open silently if anything's misconfigured; check the extension's service worker console via `chrome://extensions` → "service worker" link, and the content script console in Gmail's own devtools).
6. Click "Open dashboard →" from the options page (signed-in view) to see your tracked messages — a list with status/subject/sent-time; click any row to expand its full event timeline, including suppressed/machine-classified fetches shown greyed out with the classifier's reasoning.

## Running the mandatory acceptance test

Once the above is live: send a tracked email to a phone, let only the notification preview render (don't open the mail app), confirm the extension's status chip stays at "Delivered" with no notification; then actually open the email and confirm it upgrades to "Opened (verified)"; then click a tracked link and confirm "Clicked". This is the permanent regression described in PLAN.md section 15 — it can only run against a live deployment, which is why it isn't in the automated CI test suite (the unit-level proxies for the same six scenarios are, in `apps/backend/tests/classifier.test.ts`).
