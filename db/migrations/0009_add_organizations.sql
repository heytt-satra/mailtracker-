-- ADR-60 (team accounts, C1). No org_id column is added to `messages` —
-- shared visibility is computed at query time by joining
-- organization_members against messages.user_id, so this migration never
-- touches the message-creation hot path. A user can only own/belong to one
-- org at a time for v1 (enforced in application logic, not a DB
-- constraint).
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index idx_org_members_user_id on organization_members(user_id);
create index idx_org_members_org_id on organization_members(org_id);

-- Short invite codes (not emailed links — no email-sending integration
-- exists in this codebase; the owner shares the code through whatever
-- channel they already use). token reuses the same randomToken() shape as
-- pixel/link/API-key tokens (lib/crypto.ts).
create table organization_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  token text not null unique,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_user_id uuid references users(id)
);
create index idx_org_invites_org_id on organization_invites(org_id);

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table organization_invites enable row level security;
