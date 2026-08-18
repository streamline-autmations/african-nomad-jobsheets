-- Carries the Sibanye 2.5% discount through to the document the mine actually
-- receives.
--
-- Background: 202607200001 established that Sibanye Stillwater's 2.5% is a
-- REAL discount off what the client is billed (earned by their 30-day payment
-- term), not an internal-only deduction from AN's profit. But it only ever
-- existed on job_sheets, which is AN's internal record. Sibanye never sees a
-- job sheet -- per the NSA relationship, the only document a mine ever
-- receives is the NSA-branded quote/invoice.
--
-- So a discounted job sheet was producing an undiscounted client document:
-- AN's books gave away 2.5% that the mine was never actually billed less for.
-- On one live job sheet that was a R10,400.31 gap between the two totals.
-- Christiaan confirmed 2026-08-09 that the discount must appear on the NSA
-- document.
--
-- Kept generic (`discount_amount`, not `sibanye_discount`) because on this
-- table it is simply "a discount NSA is giving this client" -- the
-- Sibanye-specific rule for deriving it lives in feeCalculations.ts, on the
-- AN side where it belongs.

alter table public.nsa_quotes
  add column if not exists discount_amount numeric(12, 2) not null default 0;
