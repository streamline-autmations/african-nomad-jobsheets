import type {
  CompanyName,
  JobSheetFinancials,
  LineItem,
  LineItemInput,
} from "../types";

// Business constants. The cascade below was re-derived on 2026-08-19 directly
// from the two real Excel job sheets the team has always worked in
// ("Jobsheet 2pc travel bag + backpack.xlsx", "Jobsheet Rowland Cup a Soup
// project.xlsx") and reproduces both of them to the cent — see
// feeCalculations.test.ts, which pins those two sheets as fixtures. Do not
// adjust without re-running those two tests.
export const VAT_RATE = 0.15;
export const NSA_FEE_RATE = 0.1;
/**
 * Sibanye Stillwater's 2.5%, earned by their early/30-day payment.
 *
 * Corrected 2026-08-19 (this reverses the 2026-07-20 reading recorded in
 * AN_JOBSHEET_SYSTEM_CONTEXT.md): it is a **cost we carry, not a discount off
 * the client's invoice**. Sibanye is invoiced the full subtotal plus VAT —
 * their document shows no discount line at all, which the real NSA paperwork
 * corroborates ("Invoice NSA06384", "Quote 1291", both plain
 * subtotal -> VAT @ 15% on the full subtotal -> total).
 *
 * The rebate is then calculated on the **VAT-inclusive** client total, and
 * sits inside company expenses — exactly where both Excel sheets put it
 * ("Sibanye 2.5%" as a supplier row, = G56 * 0.025 / = G68 * 0.025).
 */
export const SIBANYE_REBATE_RATE = 0.025;
export const TUSCANY_FEE_RATE = 0.1;
export const SIBANYE_CUSTOMER_NAME = "Sibanye Stillwater";

// Avoids classic binary floating-point rounding (e.g. 1.005 -> 1.00) for the
// two-decimal money values this app persists and displays.
//
// Rounds on magnitude so negatives behave like positives: a loss of -1.005
// rounds to -1.01, not -1.00. Rounding the signed value directly rounds
// negatives towards zero at the half-cent and makes a loss look a cent
// smaller than it is — and losses are real here, since a job sheet is allowed
// to show one.
export function round2(value: number): number {
  const magnitude = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return value < 0 ? -magnitude : magnitude;
}

/**
 * Converts a VAT-exclusive money amount to VAT-inclusive, and back. Used
 * purely as a data-entry convenience on the line item tables — you often only
 * know one of the two numbers (a supplier's incl.-VAT invoice line, or a
 * client's excl.-VAT price list), and typing either one should fill in the
 * other rather than making you do the 15% arithmetic by hand.
 *
 * Not used anywhere in the actual sheet totals: gross profit, VAT and the
 * Sibanye rebate are all computed once at the sheet/subtotal level in
 * calculateJobSheetFinancials, from the excl.-VAT unit costs every line item
 * already stores. These two functions never touch that path — they only
 * convert what's shown in a second input field.
 */
export function inclVat(exclVatAmount: number): number {
  return round2(exclVatAmount * (1 + VAT_RATE));
}

export function exclVat(inclVatAmount: number): number {
  return round2(inclVatAmount / (1 + VAT_RATE));
}

export function withLineTotal(line: LineItemInput): LineItem {
  return { ...line, lineTotal: round2(line.qty * line.unitCost) };
}

export function calculateLinesSubtotal(lines: LineItem[]): number {
  return round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
}

// Matches "Sibanye Stillwater" itself and any mine/site customer under them
// (e.g. "Sibanye Stillwater East 3") so the rebate applies fleet-wide,
// per Christiaan's 2026-07-20 decision.
function isSibanyeStillwater(customerName: string): boolean {
  return customerName.trim().toLowerCase().startsWith(SIBANYE_CUSTOMER_NAME.toLowerCase());
}

/**
 * The one place that decides whether a job carries the Sibanye 2.5% rebate,
 * returned as a rate rather than a boolean so callers that need the amount
 * (the job-sheet cascade, the expense grid's auto row) don't each re-derive
 * the company/customer gating.
 */
export function sibanyeRebateRateFor(
  companyName: CompanyName | string,
  customerName: string,
): number {
  return companyName === "African Nomad" && isSibanyeStillwater(customerName)
    ? SIBANYE_REBATE_RATE
    : 0;
}

export interface VatBreakdown {
  vatAmount: number;
  total: number;
}

/**
 * VAT on the full subtotal — the only client-facing total sequence this app
 * has. Nothing is ever deducted before VAT: the Sibanye 2.5% is a cost on our
 * side of the sheet, not a reduction of what the client is billed.
 *
 * Shared by calculateJobSheetFinancials (AN's internal record) and
 * calculateNsaQuoteTotals (nsaQuotes.ts, the client-facing NSA document) so
 * the two can't drift apart from a one-sided edit.
 */
export function applyVat(subtotal: number): VatBreakdown {
  const vatAmount = round2(subtotal * VAT_RATE);
  return { vatAmount, total: round2(subtotal + vatAmount) };
}

export interface CalculateJobSheetFinancialsInput {
  companyName: CompanyName | string;
  customerName: string;
  clientLines: LineItem[];
  expenseLines: LineItem[];
}

/**
 * Single source of truth for every derived number on a job sheet, mirroring
 * the Excel job sheet's cascade exactly:
 *
 *   clientSubtotal   = SUM(client lines)              Excel G52 / G64
 *   vatAmount        = clientSubtotal * 15%           Excel G55 / G67
 *   clientTotal      = clientSubtotal * 1.15          Excel G56 / G68
 *   expenseTotal     = SUM(supplier lines)
 *   sibanyeRebate    = clientTotal * 2.5%             Excel "Sibanye 2.5%" row
 *   grossProfit      = clientSubtotal - expenseTotal - sibanyeRebate
 *   nsaFee/tuscanyFee= grossProfit * 10%              Excel "NSA 10%" row
 *   netProfit        = grossProfit - fees             Excel Q53 / Q65 "Profit:"
 *   netMarginPct     = netProfit / clientSubtotal     Excel Q54 / Q66
 *
 * Two orderings in there are load-bearing and were confirmed against both
 * real sheets rather than assumed:
 *   - the rebate is a percentage of the VAT-INCLUSIVE client total, not of
 *     the subtotal;
 *   - the rebate comes off BEFORE the 10% fee is worked out, so the fee is
 *     10% of what's actually left. (Travel-bag sheet: 10% of 52,908.28 =
 *     5,290.83, which is the literal value sitting in that sheet's cell P14.)
 *
 * Fees stay mutually exclusive by company, and the rebate is African
 * Nomad + Sibanye only — Tuscany SA never carries it.
 */
export function calculateJobSheetFinancials(
  input: CalculateJobSheetFinancialsInput,
): JobSheetFinancials {
  const clientSubtotal = calculateLinesSubtotal(input.clientLines);
  const { vatAmount, total: clientTotal } = applyVat(clientSubtotal);

  const expenseTotal = calculateLinesSubtotal(input.expenseLines);
  const sibanyeRebate = round2(
    clientTotal * sibanyeRebateRateFor(input.companyName, input.customerName),
  );

  const grossProfit = round2(clientSubtotal - expenseTotal - sibanyeRebate);
  const profitMarginPct =
    clientSubtotal > 0 ? round2((grossProfit / clientSubtotal) * 100) : 0;

  // NSA and the silent partner take a share of profit. There is no share of a
  // loss: on a job that loses money the fee is zero, not a negative number
  // paid back to us. Charging it against a negative gross profit would make
  // the loss read 10% smaller than it is.
  const feeBasis = Math.max(0, grossProfit);
  let nsaFee = 0;
  let tuscanyFee = 0;

  if (input.companyName === "African Nomad") {
    nsaFee = round2(feeBasis * NSA_FEE_RATE);
  } else if (input.companyName === "Tuscany SA") {
    tuscanyFee = round2(feeBasis * TUSCANY_FEE_RATE);
  }

  const totalFees = round2(nsaFee + tuscanyFee);
  const netProfit = round2(grossProfit - totalFees);
  const netMarginPct = clientSubtotal > 0 ? round2((netProfit / clientSubtotal) * 100) : 0;

  // The Excel's "Total Expenses:" cell (Q52 / Q64) — supplier costs plus the
  // Sibanye rebate plus the 10% fee, since both of those are rows inside the
  // supplier list over there. Kept separate from expenseTotal, which stays
  // the raw supplier-line sum that job_sheets.expense_total stores and that
  // the QBD Bill queue iterates.
  const totalCosts = round2(expenseTotal + sibanyeRebate + totalFees);

  return {
    clientSubtotal,
    sibanyeRebate,
    vatAmount,
    clientTotal,
    expenseTotal,
    totalCosts,
    grossProfit,
    profitMarginPct,
    nsaFee,
    tuscanyFee,
    totalFees,
    netProfit,
    netMarginPct,
  };
}
