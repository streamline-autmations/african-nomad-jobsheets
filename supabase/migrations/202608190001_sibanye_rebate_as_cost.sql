-- The Sibanye 2.5% is a cost African Nomad carries, not a discount off the
-- client's invoice.
--
-- This reverses the reading taken on 2026-07-20 (migration
-- 202607200001_sibanye_discount_fix.sql, and 202608090002_nsa_quote_discount.sql
-- which carried the discount onto the client-facing NSA document). Both of
-- those stay in history; this migration supersedes their behaviour.
--
-- What changed and why. On 2026-08-19 the two real Excel job sheets the team
-- has always worked in were parsed properly for the first time
-- ("Jobsheet 2pc travel bag + backpack.xlsx", "Jobsheet Rowland Cup a Soup
-- project.xlsx"). Both put "Sibanye 2.5%" in the SUPPLIER ITEMS / COMPANY
-- EXPENSES list, calculated as 2.5% of the VAT-INCLUSIVE client total
-- (= G56 * 0.025 / = G68 * 0.025), and both invoice the client the full
-- subtotal plus VAT with no discount line. The real NSA paperwork agrees:
-- "Invoice NSA06384" and "Quote 1291" both print a plain
-- subtotal -> "VAT @ 15% on <full subtotal>" -> total. Christiaan confirmed
-- the Excel treatment on 2026-08-19 against both worked totals side by side.
--
-- Consequences handled below:
--   1. job_sheets.sibanye_discount keeps its name but changes meaning.
--   2. Nothing client-facing may carry a discount any more, so the three
--      queue/quote payloads that copied it now write 0.
--
--   3. Drafts written under the old model are restated (section 4), since a
--      draft can be approved without being re-saved and would otherwise push
--      an Estimate whose lines and totals disagree.
--   4. Approved/synced sheets are NOT restated — they already sent QuickBooks
--      their old numbers, and rewriting them would make the app disagree with
--      what QuickBooks was actually told. Instead, invoicing one is blocked
--      by a reconciliation check (section 2) rather than silently producing a
--      mismatched invoice.

comment on column public.job_sheets.sibanye_discount is
  'Sibanye Stillwater''s 2.5%, as a COST African Nomad carries (2.5% of the '
  'VAT-inclusive client_total), not a discount off what the client is billed. '
  'Column name is historical — see migration 202608190001. Rows written before '
  '2026-08-19 hold the older pre-VAT discount meaning and were not restated.';

-- ---------------------------------------------------------------------------
-- 1. approve_job_sheet — the Estimate payload stops carrying a discount.
--
-- Unchanged from 202607210001 apart from 'discount_amount'. The bridge's
-- negative-rate discount line (bridge/src/session.ts, qbxml/builders.ts) goes
-- dormant rather than being deleted: it now always receives 0.
-- ---------------------------------------------------------------------------
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
      -- Always 0: the client is billed the full subtotal. See header.
      'discount_amount', 0,
      'vat_amount', sheet.vat_amount,
      'client_total', sheet.client_total
    )
  );

  -- One Bill per expense line, tagged with the same job so QuickBooks' Job
  -- Profitability report picks it up against this job's income. Lines with
  -- no cost (blank rows left over in the UI) are skipped; lines with no
  -- vendor typed fall back to a generic name rather than silently dropping
  -- the expense.
  --
  -- Note the Sibanye rebate and the NSA/Tuscany 10% are NOT in expense_lines —
  -- they are derived on the sheet, not typed rows — so no Bill is queued for
  -- either. That is intentional: they are internal profit adjustments, not
  -- supplier invoices QuickBooks should be chasing.
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

-- ---------------------------------------------------------------------------
-- 2. convert_job_sheet_to_invoice — same change to the Invoice payload.
--    Unchanged from 202607210003 apart from 'discount_amount'.
-- ---------------------------------------------------------------------------
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

  -- A sheet approved under the pre-2026-08-19 model carries a client_total
  -- and vat_amount computed after the old pre-VAT discount, while the payload
  -- below now sends the full client_lines with no discount. Invoicing one
  -- would put a total in QuickBooks that its own lines don't add up to, so
  -- refuse rather than guess which number was meant.
  if sheet.client_total is distinct from
     round(sheet.client_subtotal + round(sheet.client_subtotal * 0.15, 2), 2) then
    raise exception
      'job_sheet % was costed under the old discount model (subtotal %, stored total %, expected %) — re-check it before invoicing',
      p_job_sheet_id, sheet.client_subtotal, sheet.client_total,
      round(sheet.client_subtotal + round(sheet.client_subtotal * 0.15, 2), 2);
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
      -- Always 0: the client is billed the full subtotal. See header.
      'discount_amount', 0,
      'vat_amount', sheet.vat_amount,
      'client_total', sheet.client_total,
      'estimate_txn_id', sheet.qbd_estimate_txn_id
    )
  );

  return sheet;
end;
$$;

grant execute on function public.convert_job_sheet_to_invoice(uuid) to anon;

-- ---------------------------------------------------------------------------
-- 3. create_nsa_quote_from_job_sheet — the client's own document stops
--    carrying a discount. Unchanged from 202608180001 apart from the
--    discount_amount value written into nsa_quotes.
--
--    Still reads every financial number off the locked job_sheets row rather
--    than taking them as arguments, so a draft edited in another tab cannot
--    produce a quote whose lines and totals disagree.
-- ---------------------------------------------------------------------------
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
  quote public.nsa_quotes;
  company_name text;
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
    job_description, event_date, lines,
    subtotal, discount_amount, vat_amount, total,
    an_job_sheet_id
  ) values (
    p_quote_number, p_vendor_number, p_po_number, sheet.customer_name_raw, p_client_address,
    sheet.job_description, sheet.event_date, sheet.client_lines,
    -- discount_amount is always 0: the Sibanye 2.5% is our cost, and must not
    -- appear on anything the mine sees. See header.
    sheet.client_subtotal, 0, sheet.vat_amount, sheet.client_total,
    p_job_sheet_id
  )
  returning * into quote;

  update public.job_sheets set nsa_quote_id = quote.id where id = p_job_sheet_id;

  return quote;
end;
$$;

grant execute on function public.create_nsa_quote_from_job_sheet(uuid, text, text, text, text) to anon;

-- ---------------------------------------------------------------------------
-- 4. Restate every job sheet still in draft under the new cascade.
--
-- A draft written before today holds a client_total and vat_amount computed
-- AFTER the old pre-VAT discount, while approve_job_sheet now sends
-- discount_amount = 0 alongside client_lines that sum to the full subtotal.
-- Approving such a draft would push an Estimate to QuickBooks whose lines and
-- totals disagree. Drafts are recomputed on their next save anyway, but a
-- draft can be approved without being re-saved, so leaving them is a real
-- (if small) hole.
--
-- Scope is deliberately drafts only. Approved/synced sheets already sent an
-- Estimate carrying their old numbers; silently restating them would make the
-- app disagree with what QuickBooks was actually told. Those are listed for
-- Christiaan instead (checked 2026-08-19: 8 such rows, all test data —
-- "Sync test job sheet — safe to delete", "Full System Test", "Torch Delivery
-- Test Job", "IDK" — and not one has ever been invoiced).
--
-- Mirrors calculateJobSheetFinancials exactly, including greatest(...,0) on
-- the fee basis so a loss-making draft takes no fee.
-- ---------------------------------------------------------------------------
with recomputed as (
  select
    js.id,
    c.name as company_name,
    sub.client_subtotal,
    sub.expense_total,
    -- Mirrors applyVat() exactly: VAT is rounded to the cent FIRST, then added.
    -- round(subtotal * 1.15, 2) is not the same number — on a subtotal of
    -- 13.70 it gives 15.76 where the app gives 15.75 — and the rebate is a
    -- percentage of this total, so the difference propagates.
    round(sub.client_subtotal * 0.15, 2) as vat_amount,
    round(sub.client_subtotal + round(sub.client_subtotal * 0.15, 2), 2) as client_total,
    round(
      round(sub.client_subtotal + round(sub.client_subtotal * 0.15, 2), 2)
      * case
          when c.name = 'African Nomad'
           and lower(trim(js.customer_name_raw)) like 'sibanye stillwater%'
          then 0.025 else 0
        end,
      2
    ) as sibanye_rebate
  from public.job_sheets js
  join public.companies c on c.id = js.company_id
  cross join lateral (
    select
      coalesce((
        select sum((l->>'lineTotal')::numeric)
        from jsonb_array_elements(coalesce(js.client_lines, '[]'::jsonb)) l
      ), 0) as client_subtotal,
      coalesce((
        select sum((l->>'lineTotal')::numeric)
        from jsonb_array_elements(coalesce(js.expense_lines, '[]'::jsonb)) l
      ), 0) as expense_total
  ) sub
  where js.status = 'draft'
),
profited as (
  select
    r.*,
    round(r.client_subtotal - r.expense_total - r.sibanye_rebate, 2) as gross_profit
  from recomputed r
),
feed as (
  select
    p.*,
    case when p.company_name = 'African Nomad'
      then round(greatest(p.gross_profit, 0) * 0.1, 2) else 0 end as nsa_fee,
    case when p.company_name = 'Tuscany SA'
      then round(greatest(p.gross_profit, 0) * 0.1, 2) else 0 end as tuscany_fee
  from profited p
)
update public.job_sheets js set
  client_subtotal   = f.client_subtotal,
  sibanye_discount  = f.sibanye_rebate,
  vat_amount        = f.vat_amount,
  client_total      = f.client_total,
  expense_total     = f.expense_total,
  gross_profit      = f.gross_profit,
  profit_margin_pct = case when f.client_subtotal > 0
                        then round(f.gross_profit / f.client_subtotal * 100, 2) else 0 end,
  nsa_fee           = f.nsa_fee,
  tuscany_fee       = f.tuscany_fee,
  total_fees        = f.nsa_fee + f.tuscany_fee,
  net_profit        = round(f.gross_profit - (f.nsa_fee + f.tuscany_fee), 2),
  net_margin_pct    = case when f.client_subtotal > 0
                        then round((f.gross_profit - (f.nsa_fee + f.tuscany_fee))
                                   / f.client_subtotal * 100, 2) else 0 end
from feed f
where js.id = f.id;
