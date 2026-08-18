-- Migrated from the standalone Sourcing Engine repo on 2026-08-06, when the
-- sourcing tables moved into this project (`wnsjzxotknadqvznnijw`, "QuickBooks")
-- so job sheets and sourcing share one database. Original file: 202606270001_anon_admin_and_usage.sql
--
-- Replayed in the original order rather than squashed, so the RLS history stays
-- readable. Verified before applying: the sourcing schema is disjoint from the
-- job-sheet schema -- no shared table, type or function names -- and nothing
-- here grants or revokes anything schema-wide.

-- Admin UIs (suppliers + saved products) and usage reporting run as the anon role
-- now that magic-link login is removed. Grant anon write on the catalogue tables and
-- read on requests for the monthly cost rollup.
-- Paste into the Supabase SQL editor for project wnsjzxotknadqvznnijw.

-- Suppliers: anon can fully manage the catalogue from the Suppliers admin tab.
do $$ begin
  create policy "anon can manage suppliers" on public.suppliers
    for all to anon using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- Saved products: read is already granted in 202606230001; add write for the admin tab.
do $$ begin
  create policy "anon can insert saved products" on public.saved_products
    for insert to anon with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "anon can update saved products" on public.saved_products
    for update to anon using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "anon can delete saved products" on public.saved_products
    for delete to anon using (true);
exception when duplicate_object then null;
end $$;
