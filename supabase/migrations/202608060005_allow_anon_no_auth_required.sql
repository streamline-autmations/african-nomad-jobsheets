-- Migrated from the standalone Sourcing Engine repo on 2026-08-06, when the
-- sourcing tables moved into this project (`wnsjzxotknadqvznnijw`, "QuickBooks")
-- so job sheets and sourcing share one database. Original file: 202606230001_allow_anon_no_auth_required.sql
--
-- Replayed in the original order rather than squashed, so the RLS history stays
-- readable. Verified before applying: the sourcing schema is disjoint from the
-- job-sheet schema -- no shared table, type or function names -- and nothing
-- here grants or revokes anything schema-wide.

-- Remove the login requirement. Grant anon role read + write on all sourcing tables.
-- Paste into Supabase SQL editor for project wnsjzxotknadqvznnijw.

create policy "anon can read sourcing requests" on public.sourcing_requests
  for select to anon using (true);

create policy "anon can insert sourcing requests" on public.sourcing_requests
  for insert to anon with check (requester_id is null);

create policy "anon can read suppliers" on public.suppliers
  for select to anon using (true);

create policy "anon can read candidates" on public.search_candidates
  for select to anon using (true);

create policy "anon can insert candidates" on public.search_candidates
  for insert to anon with check (true);

create policy "anon can read ranked results" on public.ranked_results
  for select to anon using (true);

create policy "anon can insert ranked results" on public.ranked_results
  for insert to anon with check (true);

create policy "anon can read feedback" on public.supplier_feedback
  for select to anon using (true);

create policy "anon can insert feedback" on public.supplier_feedback
  for insert to anon with check (user_id is null);

create policy "anon can read saved products" on public.saved_products
  for select to anon using (true);

create policy "anon can read search cache" on public.search_cache
  for select to anon using (expires_at > now());

create policy "anon can insert search cache" on public.search_cache
  for insert to anon with check (true);

do $$ begin
  create policy "anon can view sourcing images" on storage.objects
    for select to anon
    using (bucket_id = 'sourcing-images');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "anon can upload sourcing images" on storage.objects
    for insert to anon
    with check (bucket_id = 'sourcing-images');
exception when duplicate_object then null;
end $$;
