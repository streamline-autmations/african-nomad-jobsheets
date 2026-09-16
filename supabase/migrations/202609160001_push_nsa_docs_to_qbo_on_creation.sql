-- Supports pushing an NSA quote/invoice into the real, now-connected
-- QuickBooks Online company at the moment it's created from a job sheet,
-- instead of a separate manual "Push to QuickBooks Online" click afterward.
--
-- qbo_estimate_id / qbo_invoice_id: the real QBO record's own Id, so a
-- retried push (or a future Estimate->Invoice conversion) can reference the
-- exact record rather than creating a duplicate.
--
-- quote_number / nsa_invoice_number are no longer typed by staff for
-- anything created through this path — api/qbo/push-nsa-quote.ts now writes
-- QuickBooks' own assigned DocNumber back onto the row after a successful
-- push, which is the real number in her books, not a guess. The manual
-- typed-number path (NsaQuoteForm's standalone "New NSA Quote" tab, for
-- quotes not tied to a job sheet) is unchanged.

alter table public.nsa_quotes
  add column if not exists qbo_estimate_id text,
  add column if not exists qbo_invoice_id text;

-- Job Sheet -> NSA Invoice (direct, no quote first) — mirrors
-- create_nsa_quote_from_job_sheet's guards exactly (row lock, not-already-
-- linked, has client lines, African Nomad only), for a job that goes
-- straight to invoice without a formal quote step first.
create or replace function public.create_nsa_invoice_from_job_sheet(
  p_job_sheet_id uuid,
  p_vendor_number text,
  p_po_number text,
  p_client_address text
)
returns public.nsa_quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  sheet public.job_sheets;
  company_name text;
  quote public.nsa_quotes;
begin
  select * into sheet from public.job_sheets where id = p_job_sheet_id for update;

  if sheet.id is null then
    raise exception 'job_sheet % not found', p_job_sheet_id;
  end if;

  if sheet.nsa_quote_id is not null then
    raise exception 'job_sheet % already has an NSA quote/invoice (%) — open the NSA Quotes tab',
      p_job_sheet_id, sheet.nsa_quote_id;
  end if;

  if jsonb_array_length(coalesce(sheet.client_lines, '[]'::jsonb)) = 0 then
    raise exception 'job_sheet % has no client lines to invoice', p_job_sheet_id;
  end if;

  select name into company_name from public.companies where id = sheet.company_id;
  if company_name is distinct from 'African Nomad' then
    raise exception
      'job_sheet % belongs to % — NSA invoices may only be created for African Nomad jobs',
      p_job_sheet_id, coalesce(company_name, 'an unknown company');
  end if;

  insert into public.nsa_quotes (
    quote_number, vendor_number, po_number, client_name, client_address,
    qbo_customer_id,
    job_description, event_date, lines,
    subtotal, discount_amount, vat_amount, total,
    an_job_sheet_id, status, invoiced_at
  ) values (
    '', p_vendor_number, p_po_number, sheet.customer_name_raw, p_client_address,
    sheet.qbo_customer_id,
    sheet.job_description, sheet.event_date, sheet.client_lines,
    sheet.client_subtotal, sheet.sibanye_discount, sheet.vat_amount, sheet.client_total,
    p_job_sheet_id, 'invoiced', now()
  )
  returning * into quote;

  update public.job_sheets set nsa_quote_id = quote.id where id = p_job_sheet_id;

  return quote;
end;
$$;

grant execute on function public.create_nsa_invoice_from_job_sheet(
  uuid, text, text, text
) to anon;
