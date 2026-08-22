-- Reconciliation Agent — schema for persisted batch runs.
--
-- No Supabase CLI wired up for this project (no local migration tracking),
-- so this is applied by hand: paste this whole file into the Supabase
-- Dashboard's SQL Editor for your project and run it once.
--
-- RLS is enabled with NO public policies on either table. All access goes
-- through the server-side service-role client (src/lib/supabase-server.ts),
-- which bypasses RLS by design — the anon key is never used to read or
-- write this data directly from the browser. For a tool whose entire
-- premise is an honest audit trail, leaving its own storage wide open by
-- default would be a bad look.

create table if not exists batch_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  seed integer not null,
  order_count integer not null,
  used_resolver boolean not null,
  naive_summary jsonb not null,
  current_summary jsonb not null
);

create table if not exists match_results (
  id uuid primary key default gen_random_uuid(),
  batch_run_id uuid not null references batch_runs(id) on delete cascade,
  payment_id text not null,
  order_id text not null,
  status text not null,
  expected_net bigint not null,
  actual_credited bigint,
  delta_paise bigint,
  tds_regime text not null,
  reason_code text,
  reason_text text
);

create index if not exists match_results_batch_run_id_idx on match_results (batch_run_id);
create index if not exists batch_runs_created_at_idx on batch_runs (created_at desc);

alter table batch_runs enable row level security;
alter table match_results enable row level security;
