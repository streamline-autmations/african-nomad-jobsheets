import type {
  CompanyName,
  JobSheetFinancials,
  LineItem,
  LineItemInput,
} from "../types";

// Business constants — these were validated against the Excel bridge template
// (zero formula errors against sample African Nomad + Sibanye Stillwater
// data). Do not adjust without re-validating against that source.
export const VAT_RATE = 0.15;
export const NSA_FEE_RATE = 0.1;
// Corrected 2026-07-20: this is a real 2.5% discount off Sibanye Stillwater's
// invoice total (their 30-day payment term earns them a real discount), not
// an internal-only deduction from AN's profit. Applied to clientSubtotal
// before VAT — VAT is then computed on the discounted subtotal.
export const SIBANYE_DISCOUNT_RATE = 0.025;
export const TUSCANY_FEE_RATE = 0.1;
export const MARGIN_TARGET_PCT = 20;
export const SIBANYE_CUSTOMER_NAME = "Sibanye Stillwater";

// Avoids classic binary floating-point rounding (e.g. 1.005 -> 1.00) for the
// two-decimal money values this app persists and displays.
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function withLineTotal(line: LineItemInput): LineItem {
  return { ...line, lineTotal: round2(line.qty * line.unitCost) };
}

export function calculateLinesSubtotal(lines: LineItem[]): number {
  return round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
}

// Matches "Sibanye Stillwater" itself and any mine/site customer under them
// (e.g. "Sibanye Stillwater East 3") so the discount applies fleet-wide,
// per Christiaan's 2026-07-20 decision.
function isSibanyeStillwater(customerName: string): boolean {
  return customerName.trim().toLowerCase().startsWith(SIBANYE_CUSTOMER_NAME.toLowerCase());
}

export interface CalculateJobSheetFinancialsInput {
  companyName: CompanyName | string;
  customerName: string;
  clientLines: LineItem[];
  expenseLines: LineItem[];
}

/**
 * Single source of truth for every derived number on a job sheet. Mirrors the
 * fee cascade rules exactly:
 *   - If Company = African Nomad and Customer = Sibanye Stillwater: a 2.5%
 *     discount off clientSubtotal (before VAT) — a real reduction to what the
 *     client is billed, which flows through to gross profit and the fee below.
 *   - African Nomad: nsa_fee = gross_profit * 10% always (computed on the
 *     post-discount profit).
 *   - Tuscany SA: tuscany_fee = gross_profit * 10% (silent partner). The
 *     Sibanye discount never applies here — same company-scoping as before.
 *   - Fees are mutually exclusive by company.
 */
export function calculateJobSheetFinancials(
  input: CalculateJobSheetFinancialsInput,
): JobSheetFinancials {
  const clientSubtotal = calculateLinesSubtotal(input.clientLines);
  const sibanyeDiscount =
    input.companyName === "African Nomad" && isSibanyeStillwater(input.customerName)
      ? round2(clientSubtotal * SIBANYE_DISCOUNT_RATE)
      : 0;
  const discountedSubtotal = round2(clientSubtotal - sibanyeDiscount);
  const vatAmount = round2(discountedSubtotal * VAT_RATE);
  const clientTotal = round2(discountedSubtotal + vatAmount);
  const expenseTotal = calculateLinesSubtotal(input.expenseLines);

  const grossProfit = round2(discountedSubtotal - expenseTotal);
  const profitMarginPct =
    discountedSubtotal > 0 ? round2((grossProfit / discountedSubtotal) * 100) : 0;

  let nsaFee = 0;
  let tuscanyFee = 0;

  if (input.companyName === "African Nomad") {
    nsaFee = round2(grossProfit * NSA_FEE_RATE);
  } else if (input.companyName === "Tuscany SA") {
    tuscanyFee = round2(grossProfit * TUSCANY_FEE_RATE);
  }

  const totalFees = round2(nsaFee + tuscanyFee);
  const netProfit = round2(grossProfit - totalFees);
  const netMarginPct =
    discountedSubtotal > 0 ? round2((netProfit / discountedSubtotal) * 100) : 0;

  return {
    clientSubtotal,
    sibanyeDiscount,
    vatAmount,
    clientTotal,
    expenseTotal,
    grossProfit,
    profitMarginPct,
    nsaFee,
    tuscanyFee,
    totalFees,
    netProfit,
    netMarginPct,
    belowMarginTarget: profitMarginPct < MARGIN_TARGET_PCT,
  };
}
