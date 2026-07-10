-- Reply detection (ADR-21) for the live database (0001_init.sql already
-- includes both changes for fresh installs — this migration exists because
-- the project's Supabase instance already has real data and can't just be
-- re-run from 0001).

-- 'replied' is the new top of the status ladder; widen the CHECK constraint
-- to allow it. Drop-and-recreate is the only way to alter a CHECK in Postgres.
alter table messages drop constraint if exists messages_status_check;
alter table messages add constraint messages_status_check
  check (status in ('sent','delivered','opened','clicked','replied','not_verifiable'));

alter table messages add column if not exists reply_detected_at timestamptz;
