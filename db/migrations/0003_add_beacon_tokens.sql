-- Track B depth beacons (ADR-19). Adds beacon_tokens + raw_events.beacon_position
-- for the live database (0001_init.sql already includes both for fresh installs
-- — this migration exists because the project's Supabase instance already has
-- real data and can't just be re-run from 0001).

create table if not exists beacon_tokens (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  token text not null unique,
  position text not null check (position in ('mid','bottom')),
  created_at timestamptz not null default now()
);
create index if not exists idx_beacon_tokens_message_id on beacon_tokens(message_id);
create index if not exists idx_beacon_tokens_token on beacon_tokens(token);
alter table beacon_tokens enable row level security;

alter table raw_events add column if not exists beacon_position text
  check (beacon_position in ('top','mid','bottom'));
