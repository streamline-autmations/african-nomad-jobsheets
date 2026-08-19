import { round2 } from "./feeCalculations";

// ---------------------------------------------------------------------------
// A note on the word "markup"
//
// The UI column is labelled "Mark-Up" (as the Excel job sheet labels it), but
// the number under it has always been a *margin*: profit as a share of the
// CLIENT price, not of the supplier cost. (A R100 cost sold at R125 is a 25%
// markup but a 20% margin.)
//
// That convention is load-bearing, not an accident — it's the same basis as
// `profitMarginPct` in feeCalculations.ts and the same basis the Excel uses in
// its own Mark-Up column, `=(E17-(P17+P18))/E17`. Switching to true markup
// would silently disagree with both.
//
// So: these functions speak margin, the label keeps saying "Mark-Up" because
// that's what the spreadsheet says, and this comment is the bridge between the
// two. Everything below is the exact inverse of the other, which is what lets
// the column be typed into as well as read.
//
// Note there is no sheet-level discount to account for here any more. Sibanye
// Stillwater's 2.5% is a cost on the expense side of the sheet, not a
// reduction of client revenue (see feeCalculations.SIBANYE_REBATE_RATE), so a
// line's margin is measured against the full client price the mine is billed.
// ---------------------------------------------------------------------------

/** The minimum a row needs for repricing — structural, so it fits whatever
 * shape the line-item grid happens to use. */
export interface RepriceableRow {
  clientQty: number;
  clientUnitCost: number;
}

/**
 * The margin % displayed on a job line. Computed from line TOTALS rather than
 * unit prices, because client qty and supplier qty legitimately differ (a
 * supplier may sell in packs of 50 while the mine is billed per unit) — and
 * the totals are what actually drive gross profit.
 *
 * `supplierTotal` is the combined cost of every supplier line this client line
 * covers, which is often more than one: in the real sheets a jacket line is
 * backed by the jacket, its branding, and its delivery.
 *
 * Returns null when there's no client total to divide by, which is how the
 * table renders "—" for a blank or supplier-only row.
 */
export function marginPctFromTotals(clientTotal: number, supplierTotal: number): number | null {
  if (clientTotal <= 0) return null;
  return round2(((clientTotal - supplierTotal) / clientTotal) * 100);
}

/**
 * The inverse: what to charge per unit so the line lands on `marginPct`.
 *
 * Returns null where the answer is undefined rather than guessing:
 *   - margin >= 100% would need an infinite price (you can't keep 100% of the
 *     revenue and still have paid the supplier something)
 *   - no client qty means there's nothing to divide the total across
 *   - no supplier cost means margin is meaningless — every price is "100%
 *     margin", so there's no single right answer and we leave the price alone
 *
 * The result is a real unit price, so it rounds to the cent. That puts a floor
 * on how exactly the target can be hit: on a cheap item at high volume, half a
 * cent per unit is a visible slice of the margin (R0.75 cost x 1000 at a 20%
 * target prices at R0.94 and lands on 20.21%). Expected, not drift — the
 * alternative is a unit price with fractions of a cent in it, which neither
 * the quote nor QuickBooks can carry.
 */
export function clientUnitCostForMargin(
  supplierTotal: number,
  clientQty: number,
  marginPct: number,
): number | null {
  if (marginPct >= 100) return null;
  if (clientQty <= 0) return null;
  if (supplierTotal <= 0) return null;

  const requiredClientTotal = supplierTotal / (1 - marginPct / 100);
  return round2(requiredClientTotal / clientQty);
}

/**
 * Reprices one row to hit a target margin against a given supplier cost,
 * leaving it untouched where that isn't possible. Used both by the per-row
 * markup input and by "apply to all lines" — same path, so a bulk apply can
 * never produce a row the manual edit wouldn't have.
 */
export function repriceRowToMargin<T extends RepriceableRow>(
  row: T,
  supplierTotal: number,
  marginPct: number,
): T {
  const clientUnitCost = clientUnitCostForMargin(supplierTotal, row.clientQty, marginPct);
  if (clientUnitCost === null) return row;
  return { ...row, clientUnitCost };
}

/**
 * Target-price mode, for "we need this in the R X range" and spot bids: given
 * what the mine will pay for the line, the most you can spend with the
 * supplier and still clear `marginPct`.
 *
 * Note this is the ex-VAT client figure. VAT and the Sibanye rebate are
 * applied at the sheet level, not per line — see calculateJobSheetFinancials.
 */
export function maxSupplierTotalForMargin(clientTotal: number, marginPct: number): number | null {
  if (clientTotal <= 0) return null;
  if (marginPct >= 100) return null;
  return round2(clientTotal * (1 - marginPct / 100));
}
