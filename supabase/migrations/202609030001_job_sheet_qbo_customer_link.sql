-- Extends the real QBO customer mirror (nsa_qbo_customers, added in
-- 202608300001) to the AN Job Sheet App (Component 1), not just the NSA
-- Quote System (Component 2) — Christiaan wants one job sheet -> quote/
-- invoice flow where picking the customer once carries its vendor number and
-- address all the way through, instead of retyping (or relying on the old
-- fuzzy "match the last quote's client_name string" prefill) at the quote
-- step.
--
-- job_sheets.qbo_customer_id is deliberately separate from job_sheets.
-- customer_id (the old, never-actually-synced QBD mirror table) — nothing
-- about that column or CustomerSelect.tsx changes here.

alter table public.job_sheets
  add column if not exists qbo_customer_id text;

-- Job Sheet -> NSA Quote: now carries the job sheet's own qbo_customer_id
-- onto the created quote automatically. No new parameter needed — like the
-- financial columns, this is read straight off the locked sheet row rather
-- than passed in from JS, so it can never disagree with what's actually
-- stored against the sheet.
create or replace function public.create_nsa_quote_from_job_sheet(
  p_job_sheet_id uuid,
  p_quote_number text,
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
    raise exception 'job_sheet % already has an NSA quote (%) — open the NSA Quotes tab',
      p_job_sheet_id, sheet.nsa_quote_id;
  end if;

  if jsonb_array_length(coalesce(sheet.client_lines, '[]'::jsonb)) = 0 then
    raise exception 'job_sheet % has no client lines to quote', p_job_sheet_id;
  end if;

  select name into company_name from public.companies where id = sheet.company_id;
  if company_name is distinct from 'African Nomad' then
    raise exception
      'job_sheet % belongs to % — NSA quotes may only be created for African Nomad jobs',
      p_job_sheet_id, coalesce(company_name, 'an unknown company');
  end if;

  insert into public.nsa_quotes (
    quote_number, vendor_number, po_number, client_name, client_address,
    qbo_customer_id,
    job_description, event_date, lines,
    subtotal, discount_amount, vat_amount, total,
    an_job_sheet_id
  ) values (
    p_quote_number, p_vendor_number, p_po_number, sheet.customer_name_raw, p_client_address,
    sheet.qbo_customer_id,
    sheet.job_description, sheet.event_date, sheet.client_lines,
    sheet.client_subtotal, sheet.sibanye_discount, sheet.vat_amount, sheet.client_total,
    p_job_sheet_id
  )
  returning * into quote;

  update public.job_sheets set nsa_quote_id = quote.id where id = p_job_sheet_id;

  return quote;
end;
$$;

-- NSA Quote -> Job Sheet: same idea in reverse, carries the quote's own
-- qbo_customer_id onto the new job sheet.
create or replace function public.create_job_sheet_from_nsa_quote(
  p_quote_id uuid,
  p_company_id uuid,
  p_customer_name_raw text,
  p_job_description text,
  p_event_date date,
  p_client_lines jsonb,
  p_client_subtotal numeric,
  p_sibanye_discount numeric,
  p_vat_amount numeric,
  p_client_total numeric,
  p_expense_total numeric,
  p_gross_profit numeric,
  p_profit_margin_pct numeric,
  p_nsa_fee numeric,
  p_tuscany_fee numeric,
  p_total_fees numeric,
  p_net_profit numeric,
  p_net_margin_pct numeric
)
returns public.job_sheets
language plpgsql
security definer
set search_path = public
as $$
declare
  quote public.nsa_quotes;
  sheet public.job_sheets;
begin
  select * into quote from public.nsa_quotes where id = p_quote_id for update;

  if quote.id is null then
    raise exception 'nsa_quote % not found', p_quote_id;
  end if;

  if quote.an_job_sheet_id is not null then
    raise exception 'nsa_quote % already has an AN job sheet (%)', p_quote_id, quote.an_job_sheet_id;
  end if;

  if quote.status not in ('accepted', 'invoiced') then
    raise exception
      'nsa_quote % must be accepted or invoiced before creating a job sheet (current status: %)',
      p_quote_id, quote.status;
  end if;

  insert into public.job_sheets (
    company_id, customer_id, customer_name_raw, qbo_customer_id, job_description, event_date,
    client_lines, expense_lines,
    client_subtotal, sibanye_discount, vat_amount, client_total, expense_total,
    gross_profit, profit_margin_pct, nsa_fee, tuscany_fee, total_fees, net_profit, net_margin_pct,
    nsa_quote_id
  ) values (
    p_company_id, null, p_customer_name_raw, quote.qbo_customer_id, p_job_description, p_event_date,
    p_client_lines, '[]'::jsonb,
    p_client_subtotal, p_sibanye_discount, p_vat_amount, p_client_total, p_expense_total,
    p_gross_profit, p_profit_margin_pct, p_nsa_fee, p_tuscany_fee, p_total_fees, p_net_profit, p_net_margin_pct,
    p_quote_id
  )
  returning * into sheet;

  update public.nsa_quotes set an_job_sheet_id = sheet.id where id = p_quote_id;

  return sheet;
end;
$$;
