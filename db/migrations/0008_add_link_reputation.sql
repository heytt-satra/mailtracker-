-- ADR-59 (URL reputation checking). Records the Google Safe Browsing
-- verdict for a link at the moment it was tracked: 'safe' (checked, no
-- threat match), 'unsafe' (checked, threat match found), or NULL (never
-- checked — no SAFE_BROWSING_API_KEY configured, the check errored or
-- timed out, or this row predates this column). Never blocks or delays
-- message creation — see apps/backend/src/routes/messages.ts's fail-open
-- handling (NFR2); this is purely a warning signal recorded alongside the
-- link, not a gate.
alter table link_tokens add column reputation_status text check (reputation_status in ('safe', 'unsafe'));
