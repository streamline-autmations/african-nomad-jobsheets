-- Approved edits compare and increment this revision in a single update.
-- QuickBooks status and linkage updates use their existing columns.
alter table public.job_sheets
  add column edit_revision integer not null default 0;
