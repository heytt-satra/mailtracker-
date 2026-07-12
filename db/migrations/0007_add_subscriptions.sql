-- ADR-36: subscription gating. Dodo Payments webhooks are the only writer —
-- see apps/backend/src/routes/billing.ts. Never trust client-side checkout
-- events alone for payment confirmation (per Dodo's own docs).
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  dodo_subscription_id text not null unique,
  status text not null check (status in ('active', 'past_due', 'cancelled', 'expired')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_subscriptions_user_id on subscriptions(user_id);
alter table subscriptions enable row level security;
