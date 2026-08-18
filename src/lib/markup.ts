import { round2 } from "./feeCalculations";
import type { PairedRow } from "./pairedLineItems";

// ---------------------------------------------------------------------------
// A note on the word "markup"
//
// The UI column is labelled "Markup", but the number under it has always been
// a *margin*: profit as a share of the CLIENT price, not of the supplier cost.
// (A R100 cost sold at R125 is a 25% markup but a 20% margin.)
//
// That convention is load-bearing, not an accident — it's the same basis as
// `profitMarginPct` and `MARGIN_TARGET_PCT` in feeCalculations.ts, so a line
// showing 20% here and the sheet's "below 20% target" flag agree with each
// other. Switching to true markup would silently break that agreement.
//
// So: these functions speak margin, the label keeps saying "Markup" because
// that's what Christiaan calls it, and this comment is the bridge between the
// two. Everything below is the exact inverse of the other, which is what lets
// the column be typed into as well as read.
// ---------------------------------------------------------------------------

/**
 * The margin % displayed on a job line. Computed from line TOTALS rather than
 * unit prices, because client qty and supplier qty legitimately differ (a
 * supplier may sell in packs of 50 while the mine is billed per unit) — and
 * the totals are what actually drive gross profit.
 *
 * `discountRate` accounts for a sheet-level discount (e.g. Sibanye
 * Stillwater's 2.5%, from feeCalculations.ts's sibanyeDiscountRateFor) that
 * isn't visible on this line's own numbers but still reduces what the
 * business actually keeps from `clientTotal`. Without it, this would show
 * the margin the line *looks* like it has, not the margin it actually nets
 * once the discount comes off — see repriceRowToMargin below, which targets
 * the same net-of-discount figure this reads back.
 *
 * Returns null when there's no client total to divide by, which is how the
 * table renders "—" for a blank or supplier-only row.
 */
export function marginPctFromTotals(
  clientTotal: number,
  supplierTotal: number,
  discountRate = 0,
): number | null {
  if (clientTotal <= 0) return null;
  const netRevenue = clientTotal * (1 - discountRate);
  if (netRevenue <= 0) return null;
  return round2(((netRevenue - supplierTotal) / netRevenue) * 100);
}

/**
 * The inverse: what to charge per unit so the line lands on `marginPct`.
 *
 * `discountRate` is a sheet-level discount (Sibanye Stillwater's 2.5%, via
 * feeCalculations.ts's sibanyeDiscountRateFor) that gets taken off the
 * client's total revenue *after* every line is priced, not per line. Left at
 * its default of 0 this behaves exactly as before. When it's set, the target
 * margin is on what the business actually nets after the discount — not on
 * the sticker price — so the required sticker price is grossed up by
 * 1/(1-discountRate) on top of the undiscounted target. Without this, a line
 * "priced to 20%" on a discounted job quietly nets less than 20%: exactly the
 * bug class that already cost a real ~R10,400 on the NSA-document side once
 * (see 202608090002_nsa_quote_discount.sql) — this is the same fix applied
 * to per-line pricing instead.
 *
 * Returns null where the answer is undefined rather than guessing:
 *   - margin >= 100% would need an infinite price (you can't keep 100% of the
 *     revenue and still have paid the supplier something)
 *   - no client qty means there's nothing to divide the total across
 *   - no supplier cost means margin is meaningless — every price is "100%
 *     margin", so there's no single right answer and we leave the price alone
 *   - discountRate >= 1 would mean the client is billed nothing at all
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
  discountRate = 0,
): number | null {
  if (marginPct >= 100) return null;
  if (clientQty <= 0) return null;
  if (supplierTotal <= 0) return null;
  if (discountRate >= 1) return null;

  const requiredNetRevenue = supplierTotal / (1 - marginPct / 100);
  const requiredClientTotal = requiredNetRevenue / (1 - discountRate);
  return round2(requiredClientTotal / clientQty);
}

/**
 * Reprices one row to hit a target margin, leaving it untouched where that
 * isn't possible. Used both by the per-row markup input and by "apply to all
 * lines" — same path, so a bulk apply can never produce a row the manual edit
 * wouldn't have. `discountRate` — see clientUnitCostForMargin.
 */
export function repriceRowToMargin(
  row: PairedRow,
  marginPct: number,
  discountRate = 0,
): PairedRow {
  const supplierTotal = round2(row.supplierQty * row.supplierUnitCost);
  const clientUnitCost = clientUnitCostForMargin(
    supplierTotal,
    row.clientQty,
    marginPct,
    discountRate,
  );
  if (clientUnitCost === null) return row;
  return { ...row, clientUnitCost };
}

/**
 * Target-price mode, for "we need this in the R X range" and spot bids: given
 * what the mine will pay for the line, the most you can spend with the
 * supplier and still clear `marginPct`.
 *
 * Note this is the ex-VAT client figure. VAT and the Sibanye discount are
 * applied to the sheet's subtotal, not per line — see calculateJobSheetFinancials.
 */
export function maxSupplierTotalForMargin(clientTotal: number, marginPct: number): number | null {
  if (clientTotal <= 0) return null;
  if (marginPct >= 100) return null;
  return round2(clientTotal * (1 - marginPct / 100));
}
