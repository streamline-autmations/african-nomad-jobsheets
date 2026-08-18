-- Migrated from the standalone Sourcing Engine repo on 2026-08-06, when the
-- sourcing tables moved into this project (`wnsjzxotknadqvznnijw`, "QuickBooks")
-- so job sheets and sourcing share one database. Original file: 202606160003_revoke_public_rls_auto_enable_execute.sql
--
-- Replayed in the original order rather than squashed, so the RLS history stays
-- readable. Verified before applying: the sourcing schema is disjoint from the
-- job-sheet schema -- no shared table, type or function names -- and nothing
-- here grants or revokes anything schema-wide.

do $$ begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public;
    revoke execute on function public.rls_auto_enable() from anon;
    revoke execute on function public.rls_auto_enable() from authenticated;
  end if;
end $$;
