-- Extends approve_job_sheet() so an approved job sheet also queues its
-- expenses as QBD Bills, each tagged with the job (Customer:Job) it belongs
-- to for QuickBooks' own Job Profitability reporting — not just the
-- client-facing Estimate as before. The bridge derives the actual
-- Customer:Job hierarchy from job_customer_name + job_name at sync time; the
-- Estimate and every expense Bill for a job sheet reference the same job so
-- QuickBooks can tie income and costs together automatically.
create or replace function public.approve_job_sheet(p_job_sheet_id uuid)
returns public.job_sheets
language plpgsql
security definer
set search_path = public
as $$
declare
  sheet public.job_sheets;
  expense_line jsonb;
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

  -- One Bill per expense line, tagged with the same job so QuickBooks' Job
  -- Profitability report picks it up against this job's income. Lines with
  -- no cost (blank rows left over in the UI) are skipped; lines with no
  -- vendor typed fall back to a generic name rather than silently dropping
  -- the expense.
  for expense_line in select * from jsonb_array_elements(coalesce(sheet.expense_lines, '[]'::jsonb))
  loop
    if coalesce((expense_line->>'lineTotal')::numeric, 0) = 0 then
      continue;
    end if;

    insert into public.qbd_sync_queue (job_sheet_id, action, payload)
    values (
      p_job_sheet_id,
      'create_bill',
      jsonb_build_object(
        'supplier_name', nullif(trim(expense_line->>'vendorName'), ''),
        'amount', (expense_line->>'lineTotal')::numeric,
        'memo', expense_line->>'description',
        'job_customer_name', sheet.customer_name_raw,
        'job_name', sheet.job_description
      )
    );
  end loop;

  return sheet;
end;
$$;
