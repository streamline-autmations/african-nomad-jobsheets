-- The reciprocal of nsa_quotes.an_job_sheet_id (added in 202607200003).
--
-- That column records "this NSA quote already produced an AN job sheet", which
-- supports the quote-first direction. But Christiaan works the other way round
-- most of the time: a mine asks, he builds a quick job sheet to cost the work
-- properly, and only then quotes. This column records the reverse hand-off —
-- "this job sheet already produced an NSA quote" — so the one-click button
-- can't fire twice and create duplicate quotes against NSA's numbering.
--
-- on delete set null, not cascade: deleting a quote must never delete the job
-- sheet, which is the internal book record and the source of the QBD sync.

alter table public.job_sheets
  add column if not exists nsa_quote_id uuid
    references public.nsa_quotes(id) on delete set null;

create index if not exists job_sheets_nsa_quote_id_idx
  on public.job_sheets(nsa_quote_id);
