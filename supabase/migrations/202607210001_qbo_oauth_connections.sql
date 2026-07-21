-- Stores QuickBooks Online OAuth tokens for connected companies (realms).
-- Only ever read/written by the Vercel serverless functions in api/qbo/*
-- using the Supabase service-role key — never by the browser/anon client,
-- since these are live access/refresh tokens.
create table if not exists public.qbo_connections (
  realm_id text primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.qbo_connections enable row level security;
-- Deliberately no policies: RLS with zero policies means even the anon
-- role is denied by default. Only the service-role key (which bypasses
-- RLS entirely) can touch this table.
