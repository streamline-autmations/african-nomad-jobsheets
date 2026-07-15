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
export const SIBANYE_EXTRA_FEE_RATE = 0.025;
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

function isSibanyeStillwater(customerName: string): boolean {
  return customerName.trim().toLowerCase() === SIBANYE_CUSTOMER_NAME.toLowerCase();
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
 *   - African Nomad: nsa_fee = gross_profit * 10% always; + sibanye_fee =
 *     gross_profit * 2.5% only when the customer is Sibanye Stillwater.
 *   - Tuscany SA: tuscany_fee = gross_profit * 10% (silent partner).
 *   - Fees are mutually exclusive by company.
 */
export function calculateJobSheetFinancials(
  input: CalculateJobSheetFinancialsInput,
): JobSheetFinancials {
  const clientSubtotal = calculateLinesSubtotal(input.clientLines);
  const vatAmount = round2(clientSubtotal * VAT_RATE);
  const clientTotal = round2(clientSubtotal + vatAmount);
  const expenseTotal = calculateLinesSubtotal(input.expenseLines);

  const grossProfit = round2(clientSubtotal - expenseTotal);
  const profitMarginPct =
    clientSubtotal > 0 ? round2((grossProfit / clientSubtotal) * 100) : 0;

  let nsaFee = 0;
  let sibanyeFee = 0;
  let tuscanyFee = 0;

  if (input.companyName === "African Nomad") {
    nsaFee = round2(grossProfit * NSA_FEE_RATE);
    if (isSibanyeStillwater(input.customerName)) {
      sibanyeFee = round2(grossProfit * SIBANYE_EXTRA_FEE_RATE);
    }
  } else if (input.companyName === "Tuscany SA") {
    tuscanyFee = round2(grossProfit * TUSCANY_FEE_RATE);
  }

  const totalFees = round2(nsaFee + sibanyeFee + tuscanyFee);
  const netProfit = round2(grossProfit - totalFees);
  const netMarginPct =
    clientSubtotal > 0 ? round2((netProfit / clientSubtotal) * 100) : 0;

  return {
    clientSubtotal,
    vatAmount,
    clientTotal,
    expenseTotal,
    grossProfit,
    profitMarginPct,
    nsaFee,
    sibanyeFee,
    tuscanyFee,
    totalFees,
    netProfit,
    netMarginPct,
    belowMarginTarget: profitMarginPct < MARGIN_TARGET_PCT,
  };
}
