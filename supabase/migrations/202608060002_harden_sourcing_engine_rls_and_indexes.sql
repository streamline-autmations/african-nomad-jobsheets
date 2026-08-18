-- Migrated from the standalone Sourcing Engine repo on 2026-08-06, when the
-- sourcing tables moved into this project (`wnsjzxotknadqvznnijw`, "QuickBooks")
-- so job sheets and sourcing share one database. Original file: 202606160002_harden_sourcing_engine_rls_and_indexes.sql
--
-- Replayed in the original order rather than squashed, so the RLS history stays
-- readable. Verified before applying: the sourcing schema is disjoint from the
-- job-sheet schema -- no shared table, type or function names -- and nothing
-- here grants or revokes anything schema-wide.

drop policy if exists "authenticated can manage suppliers" on public.suppliers;
drop policy if exists "authenticated can manage candidates" on public.search_candidates;
drop policy if exists "authenticated can manage ranked results" on public.ranked_results;
drop policy if exists "authenticated can manage saved products" on public.saved_products;
drop policy if exists "authenticated can manage search cache" on public.search_cache;

create index if not exists sourcing_requests_requester_id_idx on public.sourcing_requests(requester_id);
create index if not exists search_candidates_supplier_id_idx on public.search_candidates(supplier_id);
create index if not exists ranked_results_candidate_id_idx on public.ranked_results(candidate_id);
create index if not exists supplier_feedback_request_id_idx on public.supplier_feedback(request_id);
create index if not exists supplier_feedback_result_id_idx on public.supplier_feedback(result_id);
create index if not exists supplier_feedback_supplier_id_idx on public.supplier_feedback(supplier_id);
create index if not exists supplier_feedback_user_id_idx on public.supplier_feedback(user_id);
create index if not exists saved_products_preferred_supplier_id_idx on public.saved_products(preferred_supplier_id);

alter policy "authenticated can insert sourcing requests" on public.sourcing_requests
  with check ((select auth.uid()) = requester_id or requester_id is null);

alter policy "authenticated can update own or unassigned requests" on public.sourcing_requests
  using ((select auth.uid()) = requester_id or requester_id is null);

alter policy "authenticated can create feedback" on public.supplier_feedback
  with check ((select auth.uid()) = user_id or user_id is null);

do $$ begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from anon, authenticated;
  end if;
end $$;
