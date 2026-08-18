-- Phase 2 of the Job Sheet -> NSA Quote -> Invoice -> QuickBooks hardening
-- pass: the Job Sheet <-> NSA Quote hand-off (both directions) previously
-- had NO database-level protection at all — it was a plain client-side
-- insert followed by a separate client-side update, with no transaction, no
-- row lock, and no re-check that the link column was still null. Concretely:
--
--   1. If the insert succeeded but the link-back update failed (network
--      blip, RLS, anything), the UI reported failure while an orphaned,
--      unlinked quote/job-sheet already existed. Retrying created a second
--      one, silently.
--   2. The Job Sheet -> Quote direction never set the new quote's own
--      an_job_sheet_id, so NsaQuoteList still offered "Create AN Job Sheet"
--      on an auto-generated quote, risking a genuine duplicate job sheet.
--   3. Two rapid clicks (or two open tabs) on either direction could create
--      two links for the same source record — nothing re-checked the link
--      column was still null before writing.
--
-- This mirrors the pattern this project already uses correctly for
-- approve_job_sheet/convert_job_sheet_to_invoice: SELECT ... FOR UPDATE row
-- lock + a status/link check, all inside one function, so double-clicking or
-- firing from two tabs cannot double-create.
--
-- create_nsa_quote_from_job_sheet takes NO financial numbers as arguments —
-- it reads client_subtotal/sibanye_discount/vat_amount/client_total straight
-- off the row it just locked. A job sheet stays editable while it's still
-- 'draft' (saveJobSheetDraft's update guard), so the JS caller's in-memory
-- copy of those numbers could be stale by the time this runs (edited in
-- another tab between page load and the click); reading them from the same
-- locked row the lines come from guarantees the inserted quote's lines and
-- totals can never disagree with each other. No business math is duplicated
-- in SQL — these are already-computed columns, not a re-derivation.
--
-- create_job_sheet_from_nsa_quote, by contrast, still takes its financial
-- numbers as JS-computed arguments (calculateJobSheetFinancials) — safe
-- because it only runs once a quote is 'accepted'/'invoiced', and
-- saveNsaQuoteDraft's update guard (.eq("status", "draft")) makes a quote's
-- lines and totals immutable from the moment it leaves draft, well before
-- this function becomes callable. There is no equivalent edit-window to
-- shore up on that side.

-- ---------------------------------------------------------------------------
-- Job Sheet -> NSA Quote (Christiaan's most common direction: cost the job
-- first, quote after). Also enforces server-side that this hand-off is only
-- for African Nomad jobs — Tuscany SA has its own separate silent-partner
-- flow and must never produce NSA-branded paperwork (previously the UI
-- showed this button on every company's draft with no gating at all).
-- ---------------------------------------------------------------------------
drop function if exists public.create_nsa_quote_from_job_sheet(
  uuid, text, text, text, text, numeric, numeric, numeric, numeric
);

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
    job_description, event_date, lines,
    subtotal, discount_amount, vat_amount, total,
    an_job_sheet_id
  ) values (
    p_quote_number, p_vendor_number, p_po_number, sheet.customer_name_raw, p_client_address,
    sheet.job_description, sheet.event_date, sheet.client_lines,
    sheet.client_subtotal, sheet.sibanye_discount, sheet.vat_amount, sheet.client_total,
    p_job_sheet_id
  )
  returning * into quote;

  update public.job_sheets set nsa_quote_id = quote.id where id = p_job_sheet_id;

  return quote;
end;
$$;

grant execute on function public.create_nsa_quote_from_job_sheet(
  uuid, text, text, text, text
) to anon;

-- ---------------------------------------------------------------------------
-- NSA Quote -> Job Sheet (the reverse: a mine accepted a quote that didn't
-- start life as a job sheet). Requires the quote to actually be accepted or
-- invoiced — previously this was a UI-only check (canCreateJobSheet in
-- NsaQuoteList.tsx), not enforced by the database at all.
-- ---------------------------------------------------------------------------
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
    company_id, customer_id, customer_name_raw, job_description, event_date,
    client_lines, expense_lines,
    client_subtotal, sibanye_discount, vat_amount, client_total, expense_total,
    gross_profit, profit_margin_pct, nsa_fee, tuscany_fee, total_fees, net_profit, net_margin_pct,
    nsa_quote_id
  ) values (
    p_company_id, null, p_customer_name_raw, p_job_description, p_event_date,
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

grant execute on function public.create_job_sheet_from_nsa_quote(
  uuid, uuid, text, text, date, jsonb,
  numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric
) to anon;

-- ---------------------------------------------------------------------------
-- Backfill first: the old two-step code only ever set ONE side of the link.
-- The reverse direction (nsaToJobSheet.ts, pre-existing) called
-- markNsaQuoteConvertedToJobSheet, which set nsa_quotes.an_job_sheet_id but
-- never touched job_sheets.nsa_quote_id — so any job sheet created this way
-- still shows no linked quote, and the UI would offer "Create NSA quote" on
-- it again. Without this backfill the very next unique index would also be
-- pointless noise: it stops NEW duplicates, but does nothing for hand-offs
-- that already happened one-sided. Written generically (not against specific
-- IDs) so it's correct regardless of exactly which rows are affected, and a
-- no-op if re-run.
-- ---------------------------------------------------------------------------
update public.job_sheets js
set nsa_quote_id = nq.id
from public.nsa_quotes nq
where nq.an_job_sheet_id = js.id
  and js.nsa_quote_id is null;

-- ---------------------------------------------------------------------------
-- DB-level backstop, independent of the RPCs above: even if some future code
-- path writes to these link columns directly, two rows can never point at
-- the same counterpart. Replaces the plain (non-unique) index added in
-- 202608090001 with a unique one — a unique index still serves lookups, so
-- nothing is lost.
-- ---------------------------------------------------------------------------
drop index if exists public.job_sheets_nsa_quote_id_idx;

create unique index if not exists job_sheets_nsa_quote_id_uidx
  on public.job_sheets(nsa_quote_id) where nsa_quote_id is not null;

create unique index if not exists nsa_quotes_an_job_sheet_id_uidx
  on public.nsa_quotes(an_job_sheet_id) where an_job_sheet_id is not null;
