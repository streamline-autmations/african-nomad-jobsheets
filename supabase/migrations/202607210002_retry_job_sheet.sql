-- Lets the app retry a failed sync without needing direct SQL access (this
-- was previously only possible by manually resetting qbd_sync_queue rows).
-- Only failed job sheets can be retried; resets every failed queue row back
-- to pending and the job sheet back to 'approved' so the existing
-- jobSheetQueued() advance-on-next-sync logic picks it up normally.
create or replace function public.retry_job_sheet(p_job_sheet_id uuid)
returns public.job_sheets
language plpgsql
security definer
set search_path = public
as $$
declare
  sheet public.job_sheets;
begin
  select * into sheet from public.job_sheets where id = p_job_sheet_id for update;

  if sheet.id is null then
    raise exception 'job_sheet % not found', p_job_sheet_id;
  end if;

  if sheet.status <> 'failed' then
    raise exception 'job_sheet % is not failed (current status: %) — nothing to retry', p_job_sheet_id, sheet.status;
  end if;

  update public.qbd_sync_queue
    set status = 'pending', error_message = null, sent_at = null
    where job_sheet_id = p_job_sheet_id and status = 'failed';

  update public.job_sheets
    set status = 'approved'
    where id = p_job_sheet_id
    returning * into sheet;

  return sheet;
end;
$$;

grant execute on function public.retry_job_sheet(uuid) to anon;
