-- Corrected 2026-07-20: Sibanye Stillwater's 2.5% was wrongly modelled as an
-- internal-only deduction from AN's profit. It's actually a real discount off
-- the client's invoice total. `sibanye_fee` is renamed to `sibanye_discount`
-- to reflect that (app-side calc in src/lib/feeCalculations.ts already
-- applies it to clientSubtotal before VAT). The create_estimate queue
-- payload also now carries discount_amount so the QBD Bridge can add a real
-- discount line to the Estimate/Invoice it builds.

alter table public.job_sheets
  rename column sibanye_fee to sibanye_discount;

create or replace function public.approve_job_sheet(p_job_sheet_id uuid)
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

  if sheet.status <> 'draft' then
    raise exception 'job_sheet % is not in draft status (current status: %) — cannot re-approve', p_job_sheet_id, sheet.status;
  end if;

  update public.job_sheets
    set status = 'approved'
    where id = p_job_sheet_id
    returning * into sheet;

  if sheet.customer_id is null then
    insert into public.qbd_sync_queue (job_sheet_id, action, payload)
    values (
      p_job_sheet_id,
      'create_customer',
      jsonb_build_object('name', sheet.customer_name_raw)
    );
  end if;

  insert into public.qbd_sync_queue (job_sheet_id, action, payload)
  values (
    p_job_sheet_id,
    'create_estimate',
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
      'client_total', sheet.client_total
    )
  );

  return sheet;
end;
$$;
