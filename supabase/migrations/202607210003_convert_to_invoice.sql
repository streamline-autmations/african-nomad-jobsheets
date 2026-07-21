-- Queues a create_invoice sync action for a job sheet whose Estimate is
-- already confirmed in QBD. The bridge already supports create_invoice
-- (buildInvoiceAdd, linked back to the Estimate via LinkedTxnID) — nothing
-- in the app has ever queued one until now. Re-runnable is not needed here:
-- once qbd_invoice_txn_id is set the job sheet is considered invoiced and
-- this is blocked from firing again.
create or replace function public.convert_job_sheet_to_invoice(p_job_sheet_id uuid)
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

  if sheet.status <> 'synced' or sheet.qbd_estimate_txn_id is null then
    raise exception 'job_sheet % has no confirmed QBD estimate to invoice (status: %)', p_job_sheet_id, sheet.status;
  end if;

  if sheet.qbd_invoice_txn_id is not null then
    raise exception 'job_sheet % has already been invoiced', p_job_sheet_id;
  end if;

  insert into public.qbd_sync_queue (job_sheet_id, action, payload)
  values (
    p_job_sheet_id,
    'create_invoice',
    jsonb_build_object(
      'company_id', sheet.company_id,
      'customer_id', sheet.customer_id,
      'customer_name_raw', sheet.customer_name_raw,
      'job_description', sheet.job_description,
      'event_date', sheet.event_date,
      'client_lines', sheet.client_lines,
      'client_subtotal', sheet.client_subtotal,
      'discount_amount', sheet.sibanye_discount,
      'vat_amount', sheet.vat_amount,
      'client_total', sheet.client_total,
      'estimate_txn_id', sheet.qbd_estimate_txn_id
    )
  );

  return sheet;
end;
$$;

grant execute on function public.convert_job_sheet_to_invoice(uuid) to anon;
