-- Adds direct-invoice support to the NSA Quote System (Component 2):
-- Christiaan supplied a real NSA invoice ("Invoice NSA06384 Beanies 2.pdf")
-- showing fields the quote didn't need: a Purchase Order number, and that
-- invoices can exist without ever having gone through a formal quote first
-- (e.g. a small ad-hoc order). po_number is free text ("N/A" is a valid
-- value, matching her own template's placeholder for "none given").
--
-- an_job_sheet_id is a soft pointer (no FK enforcement needed beyond
-- reference) recording that an accepted NSA quote was converted into a real
-- AN Job Sheet (Component 1) — lets the UI hide/disable the "Create AN Job
-- Sheet" action once it's already been done, without coupling the two
-- systems' business logic together.
alter table public.nsa_quotes
  add column if not exists po_number text not null default '',
  add column if not exists an_job_sheet_id uuid references public.job_sheets(id);
