import { round2 } from "./feeCalculations";

// ---------------------------------------------------------------------------
// A note on the word "markup"
//
// This module computes true markup — profit as a share of what the SUPPLIER
// was paid, not of the client price. (R100 cost sold at R125 is a 25%
// markup.) That is what the column's own label says and what the business
// means when it says "mark it up 40%".
//
// This is a deliberate departure (2026-08-28) from the real Excel job
// sheet's own Mark-Up column, which actually computes margin
// (`=(E17-(P17+P18))/E17`) despite the label — see feeCalculations.ts'
// sheet-level `profitMarginPct`/`grossProfit`, which still uses that same
// margin basis and is unaffected by this file. Only the per-line column typed
// into on the grid uses true markup now; the sheet-level totals still
// reconcile to the two pinned Excel fixtures exactly as before.
//
// Everything below is the exact inverse of the other, which is what lets the
// column be typed into (backwards from a target markup) as well as read.
//
// Note there is no sheet-level discount to account for here. Sibanye
// Stillwater's 2.5% is a cost on the expense side of the sheet, not a
// reduction of client revenue (see feeCalculations.SIBANYE_REBATE_RATE), so a
// line's markup is measured against the full client price the mine is
// billed, same as before.
// ---------------------------------------------------------------------------

/** The minimum a row needs for repricing — structural, so it fits whatever
 * shape the line-item grid happens to use. */
export interface RepriceableRow {
  clientQty: number;
  clientUnitCost: number;
}

/**
 * The markup % displayed on a job line: profit as a share of the SUPPLIER
 * cost, computed from line TOTALS rather than unit prices, because client
 * qty and supplier qty legitimately differ (a supplier may sell in packs of
 * 50 while the mine is billed per unit) — and the totals are what actually
 * drive gross profit.
 *
 * `supplierTotal` is the combined cost of every supplier line this client
 * line covers, which is often more than one: in the real sheets a jacket
 * line is backed by the jacket, its branding, and its delivery.
 *
 * Returns null when there's no supplier cost to divide by — a markup on zero
 * cost is undefined (infinite), not zero or 100 — which is how the table
 * renders "—" for a blank, client-only, or supplier-only row.
 */
export function markupPctFromTotals(clientTotal: number, supplierTotal: number): number | null {
  if (clientTotal <= 0 || supplierTotal <= 0) return null;
  return round2(((clientTotal - supplierTotal) / supplierTotal) * 100);
}

/**
 * The inverse: what to charge per unit so the line lands on `markupPct` over
 * its supplier cost.
 *
 * Returns null where the answer is undefined rather than guessing:
 *   - markup <= -100% would need a zero or negative price
 *   - no client qty means there's nothing to divide the total across
 *   - no supplier cost means markup is meaningless — every price is an
 *     undefined ("infinite") markup on zero, so there's no single right
 *     answer and we leave the price alone
 *
 * The result is a real unit price, so it rounds to the cent. That puts a
 * floor on how exactly the target can be hit: on a cheap item at high
 * volume, half a cent per unit is a visible slice of the markup (R0.75 cost
 * x 1000 at a 20% target prices at R0.90 and lands on 20.13%). Expected, not
 * drift — the alternative is a unit price with fractions of a cent in it,
 * which neither the quote nor QuickBooks can carry.
 */
export function clientUnitCostForMarkup(
  supplierTotal: number,
  clientQty: number,
  markupPct: number,
): number | null {
  if (markupPct <= -100) return null;
  if (clientQty <= 0) return null;
  if (supplierTotal <= 0) return null;

  const requiredClientTotal = supplierTotal * (1 + markupPct / 100);
  return round2(requiredClientTotal / clientQty);
}

/**
 * Reprices one row to hit a target markup against a given supplier cost,
 * leaving it untouched where that isn't possible. Used both by the per-row
 * markup input and by "apply to all lines" — same path, so a bulk apply can
 * never produce a row the manual edit wouldn't have.
 */
export function repriceRowToMarkup<T extends RepriceableRow>(
  row: T,
  supplierTotal: number,
  markupPct: number,
): T {
  const clientUnitCost = clientUnitCostForMarkup(supplierTotal, row.clientQty, markupPct);
  if (clientUnitCost === null) return row;
  return { ...row, clientUnitCost };
}

/**
 * Target-price mode, for "we need this in the R X range" and spot bids: given
 * what the mine will pay for the line, the most you can spend with the
 * supplier and still clear `markupPct`.
 *
 * Note this is the ex-VAT client figure. VAT and the Sibanye rebate are
 * applied at the sheet level, not per line — see calculateJobSheetFinancials.
 */
export function maxSupplierTotalForMarkup(clientTotal: number, markupPct: number): number | null {
  if (clientTotal <= 0) return null;
  if (markupPct <= -100) return null;
  return round2(clientTotal / (1 + markupPct / 100));
}
