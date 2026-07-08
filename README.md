# mailtracker-

MailTrack — a Gmail email tracker that reports **verified** opens instead of every pixel fetch.

Most trackers (Mailsuite, Mailtrack.io) mark an email "read" the instant the tracking pixel is fetched — which happens constantly from Apple Mail Privacy Protection, phone notification previews, and corporate security scanners, none of which involve a human reading anything. MailTrack classifies every fetch (timing, user-agent, ASN/IP intelligence, fetch behavior) before it's allowed to escalate a message's status, and says "not verifiable" instead of lying when it can't tell.

Status: **in development**. See [PLAN.md](./PLAN.md) for the full spec, architecture, schema, roadmap, and engineering journal — it is the living source of truth for this project.

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
