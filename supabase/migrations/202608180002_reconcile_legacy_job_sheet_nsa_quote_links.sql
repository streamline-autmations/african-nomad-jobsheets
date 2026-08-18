-- Follow-up to 202608180001: that migration's backfill only reconciled one
-- direction (nsa_quotes.an_job_sheet_id -> job_sheets.nsa_quote_id, the
-- direction Christiaan's actual legacy data needed). Caught in review: the
-- OTHER direction — a legacy hand-off where job_sheets.nsa_quote_id was set
-- but the quote's own an_job_sheet_id was left null — was never repaired.
-- Verified against this project's live data that no such row currently
-- exists, but the migration itself should not depend on that being true: a
-- fresh restore, a branch, or any future drift could hit it, and
-- 202608180001's unique indexes assume both sides are already consistent by
-- the time they're created.
--
-- Also adds an explicit pre-flight check for genuine conflicts (two
-- job_sheets claiming the same quote, or vice versa) — a real bug from the
-- old un-guarded two-step code, not just a one-sided link. If that ever
-- exists, this fails loudly with a clear message instead of a bare unique-
-- constraint error the next time these indexes are (re)built from scratch.

do $$
declare
  conflict_count int;
begin
  select count(*) into conflict_count
  from (
    select nsa_quote_id from public.job_sheets
    where nsa_quote_id is not null
    group by nsa_quote_id having count(*) > 1
  ) dupes;

  if conflict_count > 0 then
    raise exception
      '% job_sheets share the same nsa_quote_id — resolve manually before this migration can proceed (a real duplicate hand-off, not just a one-sided link)',
      conflict_count;
  end if;

  select count(*) into conflict_count
  from (
    select an_job_sheet_id from public.nsa_quotes
    where an_job_sheet_id is not null
    group by an_job_sheet_id having count(*) > 1
  ) dupes;

  if conflict_count > 0 then
    raise exception
      '% nsa_quotes share the same an_job_sheet_id — resolve manually before this migration can proceed (a real duplicate hand-off, not just a one-sided link)',
      conflict_count;
  end if;
end $$;

-- The reverse backfill 202608180001 was missing.
update public.nsa_quotes nq
set an_job_sheet_id = js.id
from public.job_sheets js
where js.nsa_quote_id = nq.id
  and nq.an_job_sheet_id is null;
