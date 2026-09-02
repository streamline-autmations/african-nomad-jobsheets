-- Real customer mirror for the NSA Quote System (Component 2), pulled from
-- NSA's actual QuickBooks Online company via api/qbo/sync-nsa-customers.
--
-- Replaces the fragile "match on nsa_quotes.client_name string" approach
-- (fetchLatestNsaQuoteForClient in src/lib/nsaQuotes.ts) with a real link to
-- QBO's own Customer/Sub-customer records, so Bill to/Ship to and vendor
-- number auto-fill from a picked customer instead of being retyped or
-- guessed from the last quote with a matching name.
--
-- vendor_number is NOT a QBO field — QBO has no native concept of "NSA's
-- vendor number with this mine". We own that column ourselves, keyed to the
-- QBO customer, so a sync never overwrites a value staff have entered here.

create table if not exists public.nsa_qbo_customers (
  id uuid primary key default gen_random_uuid(),

  -- QBO's own Customer.Id for this realm. Unique per company; if NSA's QBO
  -- connection is ever swapped for a different realm this table should be
  -- re-synced from scratch rather than trusted across realms.
  qbo_customer_id text not null unique,

  display_name text not null,
  -- Sub-customer/Job parent, e.g. "Sibanye Rustenburg Mine Pty Ltd" is the
  -- parent of the "Saffy Shaft" sub-customer. Null for a top-level customer.
  parent_qbo_customer_id text,
  is_sub_customer boolean not null default false,

  bill_address text not null default '',
  ship_address text not null default '',

  -- Ours to manage — never written by the sync job once set.
  vendor_number text not null default '',

  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nsa_qbo_customers_display_name_idx
  on public.nsa_qbo_customers(display_name);
create index if not exists nsa_qbo_customers_parent_idx
  on public.nsa_qbo_customers(parent_qbo_customer_id);

alter table public.nsa_qbo_customers enable row level security;

-- Same posture as nsa_quotes: internal single-team tool, no Supabase Auth.
-- Anon can read (to populate the picker) and update (to edit vendor_number
-- inline), but sync/insert only ever happens via the service-role key in
-- api/qbo/sync-nsa-customers.ts — anon never creates rows here, so a typo'd
-- customer name in the app can't silently masquerade as a synced QBO record.
do $$ begin
  create policy "anon can read nsa qbo customers" on public.nsa_qbo_customers
    for select to anon using (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "anon can update nsa qbo customers" on public.nsa_qbo_customers
    for update to anon using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- Soft link from a quote/invoice back to the real QBO customer it was raised
-- against, once one was picked from the synced list. Nullable: quotes for a
-- customer not yet synced (or created before this migration) keep using the
-- free-text client_name/client_address as before.
alter table public.nsa_quotes
  add column if not exists qbo_customer_id text;
