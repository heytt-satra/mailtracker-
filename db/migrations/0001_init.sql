-- MailTrack initial schema. Mirrors PLAN.md section 7 exactly; keep them in sync.
-- Apply via the Supabase SQL editor or `supabase db push` once a project is provisioned.

create extension if not exists pgcrypto;

-- id is the Supabase Auth user's own id (the classic "profiles" pattern) —
-- no separate auth_user_id indirection column. A row here is created by
-- POST /v1/auth/provision the first time someone with a valid Supabase
-- session (signed up via email+password, or later Google OAuth) provisions
-- a MailTrack API key; there is no other creation path.
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  api_key_hash text not null unique,
  email text,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  gmail_message_id text,
  pixel_token text not null unique,
  -- Plaintext, not hashed: this is the sender's own subject line, shown
  -- back to the same sender in the dashboard message list (M5) — there is
  -- no third party involved, so hashing would only make the field useless
  -- (a hash can't be un-hashed to display). An earlier draft of this schema
  -- stored subject_hash instead and it went completely unused — no code
  -- ever wrote or read it — because a one-way hash can't serve the actual
  -- product need. Capped at 500 chars at the API layer (routes/messages.ts).
  subject text,
  -- Plaintext, same reasoning as subject above. Added because a single
  -- sender may reuse the same subject line across many recipients, making
  -- subject alone useless for telling tracked sends apart in the dashboard
  -- — see db/migrations/0002_add_recipient.sql for the live-DB migration.
  recipient text,
  sent_at timestamptz not null default now(),
  -- 'replied' (ADR-21) is the top of the escalate-only ladder — see
  -- classifier/escalation.ts. db/migrations/0005_add_reply_detection.sql is
  -- the live-DB migration that widened this constraint.
  status text not null default 'sent'
    check (status in ('sent','delivered','opened','clicked','replied','not_verifiable')),
  status_updated_at timestamptz not null default now(),
  -- ADR-20: orthogonal to status above, deliberately not part of the
  -- escalate-only ladder — a bounce is discovered proof the message never
  -- arrived at all, not increased confidence of engagement. See
  -- db/migrations/0004_add_bounce_detection.sql for the live-DB migration.
  bounce_detected_at timestamptz,
  bounce_reason text,
  -- ADR-21: set when the recipient replies in the tracked thread. Distinct
  -- from status='replied' (which this drives) so the exact detection time is
  -- retained. See db/migrations/0005_add_reply_detection.sql.
  reply_detected_at timestamptz
);
create index idx_messages_pixel_token on messages(pixel_token);
create index idx_messages_user_id on messages(user_id);

create table link_tokens (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  token text not null unique,
  original_url text not null
);
create index idx_link_tokens_message_id on link_tokens(message_id);

-- Track B depth beacons (ADR-19). A message only gets rows here when its
-- composed HTML body was long enough to plausibly hit Gmail's ~102KB "message
-- clipped" threshold (see LONG_MESSAGE_BEACON_THRESHOLD_BYTES in
-- apps/backend/src/routes/messages.ts) — most messages have none. Separate
-- from messages.pixel_token so the original open-detection path (ADR-1/ADR-4)
-- is never touched by this addition.
create table beacon_tokens (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  token text not null unique,
  position text not null check (position in ('mid','bottom')),
  created_at timestamptz not null default now()
);
create index idx_beacon_tokens_message_id on beacon_tokens(message_id);
create index idx_beacon_tokens_token on beacon_tokens(token);

create table raw_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  kind text not null check (kind in ('pixel_fetch','link_click')),
  occurred_at timestamptz not null default now(),
  user_agent text,
  ip_hash text not null,
  asn integer,
  headers jsonb,
  fetch_sequence_ms integer,
  -- Resolved once, inline, at log time (see classify_ip_category below) while
  -- the raw IP is still in hand — ip_hash alone can't be range-matched later.
  ip_category text check (ip_category in ('apple_mpp','security_scanner','residential_isp','datacenter_other','unknown')),
  -- null until the classifier sweep (wrangler.toml cron) processes this row.
  -- Lets the sweep cheaply select `where classified_at is null` instead of
  -- diffing against the verdicts table on every run.
  classified_at timestamptz,
  -- 'top' for the original pixel, 'mid'/'bottom' for Track B depth beacons
  -- (ADR-19), null for link_click rows (position doesn't apply to a click).
  beacon_position text check (beacon_position in ('top','mid','bottom')),
  -- ADR-30: which tracked link was actually clicked (the original, real URL —
  -- not our redirect token), so the timeline can show WHICH link, not just
  -- "a link". Null for pixel_fetch rows. See db/migrations/0006_add_clicked_url.sql.
  clicked_url text
);
create index idx_raw_events_message_id on raw_events(message_id);
create index idx_raw_events_occurred_at on raw_events(occurred_at);
create index idx_raw_events_unclassified on raw_events(id) where classified_at is null;

create table verdicts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  raw_event_id uuid references raw_events(id),
  verdict text not null check (verdict in ('machine_suspect','verified_open','verified_click','not_verifiable')),
  reason text not null,
  created_at timestamptz not null default now()
);
create index idx_verdicts_message_id on verdicts(message_id);

create table asn_intel (
  asn integer primary key,
  org_name text,
  category text not null check (category in ('apple_mpp','security_scanner','residential_isp','datacenter_other','unknown')),
  updated_at timestamptz not null default now()
);

-- ADR-8 (see PLAN.md): Apple Private Relay egress does NOT always come from
-- Apple's own ASN — the second relay hop can egress through third-party CDN
-- partners, so a pure ASN->category mapping would misclassify unrelated
-- traffic that happens to share an ASN with a CDN partner. Apple instead
-- publishes an authoritative egress IP-range list, so Apple MPP detection is
-- IP-range based (this table) rather than ASN based. asn_intel remains the
-- right mechanism for security scanners, which DO run their own dedicated
-- ASINs (Proofpoint, Mimecast, Barracuda etc).
create table ip_ranges (
  cidr cidr primary key,
  category text not null check (category in ('apple_mpp','security_scanner','residential_isp','datacenter_other','unknown')),
  source text not null, -- e.g. 'apple-egress-ip-ranges', refreshed weekly
  updated_at timestamptz not null default now()
);

-- Longest-prefix-match lookup: the most specific (highest masklen) matching
-- range wins. Table is small (low hundreds of rows), so a full scan with the
-- native `<<=` (inet contained-by-or-equal cidr) operator is fast without a
-- specialized index.
create or replace function classify_ip_category(p_ip inet)
returns text
language sql
stable
as $$
  select category from ip_ranges where p_ip <<= cidr order by masklen(cidr) desc limit 1
$$;

-- Row Level Security: service role (used by the Worker) bypasses RLS by default.
-- These tables are never queried with the anon key, so RLS is enabled with no
-- policies as defense-in-depth against key misconfiguration.
alter table users enable row level security;
alter table messages enable row level security;
alter table link_tokens enable row level security;
alter table beacon_tokens enable row level security;
alter table raw_events enable row level security;
alter table verdicts enable row level security;
alter table asn_intel enable row level security;
alter table ip_ranges enable row level security;
