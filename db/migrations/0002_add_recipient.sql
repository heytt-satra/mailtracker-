-- Adds messages.recipient for the live database (0001_init.sql already
-- includes this column for fresh installs — this migration exists because
-- the project's Supabase instance already has real data and can't just be
-- re-run from 0001).
alter table messages add column if not exists recipient text;
