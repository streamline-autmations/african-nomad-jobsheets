-- Both job_sheets and nsa_quotes were deliberately built with no anon DELETE
-- policy (see 202607150001's "this is client-facing paperwork history, not
-- disposable draft state"). That's still the right call for anything that's
-- left draft status — an approved/synced job sheet or a sent/accepted/
-- invoiced quote represents a real document, possibly already pushed to
-- QuickBooks. This adds deletion for draft-only, so test/junk records made
-- while building/testing this app (or a genuine mis-entry never actioned)
-- can be cleaned up, without ever allowing a real record to be erased.
--
-- Enforced here at the RLS level, not just hidden in the UI — a client bug
-- can't delete something it shouldn't.

do $$ begin
  create policy "anon can delete draft job sheets" on public.job_sheets
    for delete to anon using (status = 'draft');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "anon can delete draft nsa quotes" on public.nsa_quotes
    for delete to anon using (status = 'draft');
exception when duplicate_object then null;
end $$;
