-- Component 2: NSA Quote System (planned 2026-07-20, see
-- AN_JOBSHEET_SYSTEM_CONTEXT.md "Component 2 — NSA Quote System").
--
-- Deliberately separate from job_sheets/companies/customers — this is a
-- standalone client-facing NSA-branded quote/invoice generator, simulating
-- what NSA's own real QuickBooks Online account would produce (Christiaan
-- doesn't have access to that real account and doesn't want to risk
-- touching her live system). quote_number and vendor_number are free text,
-- not auto-generated sequences: NSA's real numbering is unknown to us and we
-- must not collide with it — staff type in the number NSA's own system would
-- assign (or already has assigned, for a quote created after the fact).

create table if not exists public.nsa_quotes (
  id uuid primary key default gen_random_uuid(),

  quote_number text not null,
  -- NSA's vendor number is assigned per-mine (each mine issues her a
  -- different one), not a single company-wide constant.
  vendor_number text not null default '',

  client_name text not null default '',
  client_address text not null default '',
  job_description text not null default '',
  event_date date,

  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'invoiced')),

  lines jsonb not null default '[]'::jsonb,

  subtotal numeric(12, 2) not null default 0,
  vat_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,

  -- Set once the accepted quote is flipped into an NSA-branded invoice.
  nsa_invoice_number text,

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  accepted_at timestamptz,
  invoiced_at timestamptz
);

create index if not exists nsa_quotes_status_idx on public.nsa_quotes(status);
create index if not exists nsa_quotes_created_at_idx on public.nsa_quotes(created_at desc);

alter table public.nsa_quotes enable row level security;

-- Same posture as job_sheets: internal single-team tool, no Supabase Auth,
-- broad anon access, but no DELETE — this is client-facing paperwork history,
-- not disposable draft state.
do $$ begin
  create policy "anon can read nsa quotes" on public.nsa_quotes
    for select to anon using (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can insert nsa quotes" on public.nsa_quotes
    for insert to anon with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can update nsa quotes" on public.nsa_quotes
    for update to anon using (true) with check (true);
exception when duplicate_object then null;
end $$;
