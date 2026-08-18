-- Migrated from the standalone Sourcing Engine repo on 2026-08-06, when the
-- sourcing tables moved into this project (`wnsjzxotknadqvznnijw`, "QuickBooks")
-- so job sheets and sourcing share one database. Original file: 202606180001_allow_frontend_fallback_inserts.sql
--
-- Replayed in the original order rather than squashed, so the RLS history stays
-- readable. Verified before applying: the sourcing schema is disjoint from the
-- job-sheet schema -- no shared table, type or function names -- and nothing
-- here grants or revokes anything schema-wide.

create policy "authenticated can insert fallback candidates" on public.search_candidates
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.sourcing_requests requests
      where requests.id = search_candidates.request_id
        and (requests.requester_id is null or requests.requester_id = (select auth.uid()))
    )
  );

create policy "authenticated can insert fallback ranked results" on public.ranked_results
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.sourcing_requests requests
      where requests.id = ranked_results.request_id
        and (requests.requester_id is null or requests.requester_id = (select auth.uid()))
    )
  );
