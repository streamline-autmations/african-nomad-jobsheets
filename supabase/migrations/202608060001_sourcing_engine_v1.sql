-- Migrated from the standalone Sourcing Engine repo on 2026-08-06, when the
-- sourcing tables moved into this project (`wnsjzxotknadqvznnijw`, "QuickBooks")
-- so job sheets and sourcing share one database. Original file: 202606150001_sourcing_engine_v1.sql
--
-- Replayed in the original order rather than squashed, so the RLS history stays
-- readable. Verified before applying: the sourcing schema is disjoint from the
-- job-sheet schema -- no shared table, type or function names -- and nothing
-- here grants or revokes anything schema-wide.

create extension if not exists pgcrypto;

do $$ begin
  create type public.match_strictness as enum ('Exact', 'Similar', 'Broad substitute');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.source_mode as enum ('SA first', 'Balanced', 'Imports allowed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sourcing_status as enum ('Draft', 'Searching', 'Ready', 'Needs review', 'Archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.feedback_status as enum (
    'approved',
    'rejected',
    'contacted',
    'quoted',
    'ordered',
    'unavailable',
    'wrong product'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.sourcing_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid references auth.users(id) on delete set null,
  query_text text not null default '',
  notes text not null default '',
  quantity integer not null default 1 check (quantity > 0),
  strictness public.match_strictness not null default 'Similar',
  source_mode public.source_mode not null default 'SA first',
  status public.sourcing_status not null default 'Draft',
  image_path text,
  location text,
  deadline date,
  product_signal jsonb not null default '{}'::jsonb,
  estimated_cost_usd numeric(10, 4) not null default 0,
  cache_hit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Uncategorised',
  website text,
  contact_name text,
  contact_email text,
  contact_phone text,
  location text,
  reliability_score integer not null default 50 check (reliability_score between 0 and 100),
  preferred boolean not null default false,
  lead_time text,
  payment_terms text,
  reliability_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, website)
);

create table if not exists public.search_candidates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sourcing_requests(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  title text not null,
  supplier_name text not null,
  source text not null,
  url text,
  image_url text,
  price numeric(12, 2),
  currency text not null default 'ZAR',
  unit_price numeric(12, 2),
  moq integer,
  quantity_available integer,
  location text,
  delivery_estimate text,
  shipping_cost numeric(12, 2),
  match_score integer check (match_score between 0 and 100),
  confidence integer check (confidence between 0 and 100),
  risk_flags text[] not null default '{}',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ranked_results (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sourcing_requests(id) on delete cascade,
  candidate_id uuid references public.search_candidates(id) on delete cascade,
  rank integer not null check (rank > 0),
  match_score integer not null check (match_score between 0 and 100),
  price_score integer not null check (price_score between 0 and 100),
  delivery_score integer not null check (delivery_score between 0 and 100),
  supplier_confidence integer not null check (supplier_confidence between 0 and 100),
  explanation text not null,
  badges text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (request_id, rank)
);

create table if not exists public.supplier_feedback (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sourcing_requests(id) on delete cascade,
  result_id uuid references public.ranked_results(id) on delete cascade,
  candidate_id uuid references public.search_candidates(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  status public.feedback_status not null,
  notes text not null default '',
  actual_price numeric(12, 2),
  actual_delivery_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.saved_products (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  category text not null default 'General procurement',
  aliases text[] not null default '{}',
  known_specs jsonb not null default '{}'::jsonb,
  preferred_supplier_id uuid references public.suppliers(id) on delete set null,
  last_checked_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_name)
);

create table if not exists public.search_cache (
  cache_key text primary key,
  normalized_query text not null,
  source_mode public.source_mode not null default 'SA first',
  strictness public.match_strictness not null default 'Similar',
  payload jsonb not null,
  estimated_cost_usd numeric(10, 4) not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sourcing_requests_created_at_idx on public.sourcing_requests(created_at desc);
create index if not exists search_candidates_request_id_idx on public.search_candidates(request_id);
create index if not exists ranked_results_request_rank_idx on public.ranked_results(request_id, rank);
create index if not exists supplier_feedback_candidate_id_idx on public.supplier_feedback(candidate_id);
create index if not exists suppliers_preferred_category_idx on public.suppliers(preferred, category);
create index if not exists saved_products_aliases_idx on public.saved_products using gin(aliases);
create index if not exists search_cache_expires_at_idx on public.search_cache(expires_at);

alter table public.sourcing_requests enable row level security;
alter table public.suppliers enable row level security;
alter table public.search_candidates enable row level security;
alter table public.ranked_results enable row level security;
alter table public.supplier_feedback enable row level security;
alter table public.saved_products enable row level security;
alter table public.search_cache enable row level security;

insert into storage.buckets (id, name, public)
values ('sourcing-images', 'sourcing-images', false)
on conflict (id) do nothing;

create policy "authenticated can read sourcing data" on public.sourcing_requests
  for select to authenticated using (true);
create policy "authenticated can insert sourcing requests" on public.sourcing_requests
  for insert to authenticated with check (auth.uid() = requester_id or requester_id is null);
create policy "authenticated can update own or unassigned requests" on public.sourcing_requests
  for update to authenticated using (auth.uid() = requester_id or requester_id is null);

create policy "authenticated can read suppliers" on public.suppliers
  for select to authenticated using (true);
create policy "authenticated can manage suppliers" on public.suppliers
  for all to authenticated using (true) with check (true);

create policy "authenticated can read candidates" on public.search_candidates
  for select to authenticated using (true);
create policy "authenticated can manage candidates" on public.search_candidates
  for all to authenticated using (true) with check (true);

create policy "authenticated can read ranked results" on public.ranked_results
  for select to authenticated using (true);
create policy "authenticated can manage ranked results" on public.ranked_results
  for all to authenticated using (true) with check (true);

create policy "authenticated can read feedback" on public.supplier_feedback
  for select to authenticated using (true);
create policy "authenticated can create feedback" on public.supplier_feedback
  for insert to authenticated with check (auth.uid() = user_id or user_id is null);

create policy "authenticated can read saved products" on public.saved_products
  for select to authenticated using (true);
create policy "authenticated can manage saved products" on public.saved_products
  for all to authenticated using (true) with check (true);

create policy "authenticated can read search cache" on public.search_cache
  for select to authenticated using (expires_at > now());
create policy "authenticated can manage search cache" on public.search_cache
  for all to authenticated using (true) with check (true);

do $$ begin
  create policy "authenticated can view sourcing images" on storage.objects
    for select to authenticated
    using (bucket_id = 'sourcing-images');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "authenticated can upload sourcing images" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'sourcing-images');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "authenticated can update sourcing images" on storage.objects
    for update to authenticated
    using (bucket_id = 'sourcing-images')
    with check (bucket_id = 'sourcing-images');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "authenticated can delete sourcing images" on storage.objects
    for delete to authenticated
    using (bucket_id = 'sourcing-images');
exception when duplicate_object then null;
end $$;

insert into public.suppliers (name, category, website, location, preferred, lead_time, payment_terms, reliability_score, reliability_notes)
values
  ('Makro Business', 'Retail bulk', 'https://www.makro.co.za', 'National', true, '2-5 days', 'Card / account', 86, 'Good first-pass source for common retail and office products.'),
  ('Takealot Marketplace', 'Retail marketplace', 'https://www.takealot.com', 'National', true, '2-7 days', 'Card / EFT', 78, 'Useful for availability checks, but seller quality varies.'),
  ('Local Corporate Gifting Directory', 'Brandable gifts', 'internal://suppliers/corporate-gifting', 'Johannesburg / Cape Town', true, '5-12 days', 'EFT', 82, 'Manual directory for preferred gifting suppliers.'),
  ('Event & Catering Supplier List', 'Food and event supplies', 'internal://suppliers/events', 'Gauteng', true, '1-4 days', 'EFT / COD', 80, 'Use for soup, rolls, containers, and event consumables.')
on conflict (name, website) do nothing;

insert into public.saved_products (canonical_name, category, aliases, notes)
values
  ('500ml stainless steel travel mug', 'Corporate gifting', array['travel mug', 'insulated mug', 'vacuum flask', 'thermos cup'], 'Common corporate gifting item.'),
  ('Fleece blanket', 'Mining supply / gifting', array['blanket', 'polar fleece blanket', 'winter blanket'], 'Common winter supply request.'),
  ('Soup container', 'Event supplies', array['soup cup', 'takeaway soup bowl', 'food container'], 'Used for food functions and staff activations.')
on conflict (canonical_name) do nothing;
