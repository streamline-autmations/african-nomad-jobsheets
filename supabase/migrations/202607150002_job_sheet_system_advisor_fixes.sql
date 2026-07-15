-- Follow-up hardening based on Supabase's security/performance advisors run
-- right after applying 202607150001_job_sheet_system_v1.sql.

-- 1. job_sheets_stamp_approved_at was missing a fixed search_path (the other
--    two functions in the previous migration already had it). Cheap fix for
--    the function_search_path_mutable advisory.
create or replace function public.job_sheets_stamp_approved_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and new.approved_at is null then
    new.approved_at := now();
  end if;
  return new;
end;
$$;

-- 2. qbd_sync_queue_requires_approval() is a trigger function (returns
--    pseudo-type "trigger") — Postgres refuses to call it outside trigger
--    context, so exposing it as a public RPC via PostgREST is dead surface
--    area, not a real capability. Revoke it explicitly rather than leave the
--    advisor warning dangling. Mirrors the sourcing engine's own pattern of
--    revoking execute on housekeeping functions it didn't mean to expose.
revoke execute on function public.qbd_sync_queue_requires_approval() from anon;
revoke execute on function public.qbd_sync_queue_requires_approval() from authenticated;

-- 3. common_expenses had two overlapping anon policies (a SELECT-only one
--    and a FOR ALL one that already covers SELECT). Phase 2 only ever reads
--    this table for expense-description suggestions — no admin UI to manage
--    it was requested, so drop the write-capable policy rather than keep
--    unused surface area, and it also clears the multiple_permissive_policies
--    performance advisory.
drop policy if exists "anon can manage common expenses" on public.common_expenses;
