-- TaxMate Tradie — database schema
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New
-- query → paste this whole file → Run). Safe to re-run: every statement is
-- idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- One row per user, holding their entire app state as JSON — matches the
-- AppData shape in src/types.ts exactly, so the client can be a thin proxy
-- with no schema migrations needed as features are added.

create table if not exists app_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_data enable row level security;

-- Row-level security: every policy is scoped to auth.uid() = user_id, so a
-- logged-in user can only ever read or write their own row — Postgres
-- enforces this on every query, including ones that come through a bug in
-- the client code. There is deliberately no delete policy; nothing in the
-- app needs to delete a whole account's data.

drop policy if exists "Users can view their own data" on app_data;
create policy "Users can view their own data"
  on app_data for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own data" on app_data;
create policy "Users can insert their own data"
  on app_data for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own data" on app_data;
create policy "Users can update their own data"
  on app_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
