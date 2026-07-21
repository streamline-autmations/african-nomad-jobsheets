-- Broadens retry_job_sheet(): the original version only handled a job sheet
-- whose own status was 'failed' (its Estimate/Invoice failed). It missed the
-- equally real case where the Estimate succeeded (status stays 'synced')
-- but a sibling expense Bill failed independently — e.g. a missing expense
-- account. Now it retries whatever failed rows actually exist, regardless
-- of the job sheet's own status, and only reverts job_sheets.status to
-- 'approved' when the sheet itself was the thing that failed.
create or replace function public.retry_job_sheet(p_job_sheet_id uuid)
returns public.job_sheets
language plpgsql
security definer
set search_path = public
as $$
declare
  sheet public.job_sheets;
  retried_count int;
begin
  select * into sheet from public.job_sheets where id = p_job_sheet_id for update;

  if sheet.id is null then
    raise exception 'job_sheet % not found', p_job_sheet_id;
  end if;

  with reset as (
    update public.qbd_sync_queue
      set status = 'pending', error_message = null, sent_at = null
      where job_sheet_id = p_job_sheet_id and status = 'failed'
      returning 1
  )
  select count(*) into retried_count from reset;

  if retried_count = 0 and sheet.status <> 'failed' then
    raise exception 'job_sheet % has nothing to retry', p_job_sheet_id;
  end if;

  if sheet.status = 'failed' then
    update public.job_sheets
      set status = 'approved'
      where id = p_job_sheet_id
      returning * into sheet;
  end if;

  return sheet;
end;
$$;

grant execute on function public.retry_job_sheet(uuid) to anon;
