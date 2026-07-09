-- Hard-bounce detection (ADR-20) for the live database (0001_init.sql already
-- includes these columns for fresh installs — this migration exists because
-- the project's Supabase instance already has real data and can't just be
-- re-run from 0001).
alter table messages add column if not exists bounce_detected_at timestamptz;
alter table messages add column if not exists bounce_reason text;
