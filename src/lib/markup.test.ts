import { describe, expect, it } from "vitest";
import {
  clientUnitCostForMarkup,
  markupPctFromTotals,
  maxSupplierTotalForMarkup,
  repriceRowToMarkup,
} from "./markup";
import { round2 } from "./feeCalculations";
import type { RepriceableRow } from "./markup";

function row(overrides: Partial<RepriceableRow> = {}): RepriceableRow {
  return { clientQty: 1000, clientUnitCost: 30.74, ...overrides };
}

describe("markupPctFromTotals", () => {
  it("matches the everyday meaning of markup: profit over cost", () => {
    // R125 charged against R100 of cost = 25% markup.
    expect(markupPctFromTotals(125, 100)).toBe(25);
  });

  it("is a bigger number than margin on the same line", () => {
    // R268,000 charged against R200,000 of cost: 34% markup vs 25.37% margin.
    expect(markupPctFromTotals(268000, 200000)).toBe(34);
  });

  it("returns null rather than dividing by zero when there's no supplier cost", () => {
    // Undefined ("infinite"), not zero or 100 — there's no real answer.
    expect(markupPctFromTotals(500, 0)).toBeNull();
    expect(markupPctFromTotals(0, 0)).toBeNull();
  });

  it("returns null on a blank or supplier-only row", () => {
    expect(markupPctFromTotals(0, 250)).toBeNull();
  });

  it("goes negative when a line is being sold at a loss", () => {
    expect(markupPctFromTotals(100, 150)).toBeCloseTo(-33.33, 2);
  });
});

describe("clientUnitCostForMarkup", () => {
  it("prices a line to hit the 25% target", () => {
    // R8,000 of cost over 1000 units, marked up 25% -> R10,000 -> R10/unit.
    expect(clientUnitCostForMarkup(8000, 1000, 25)).toBe(10);
  });

  it("refuses a markup of -100% or less, which would need a zero or negative price", () => {
    expect(clientUnitCostForMarkup(8000, 1000, -100)).toBeNull();
    expect(clientUnitCostForMarkup(8000, 1000, -150)).toBeNull();
  });

  it("has no upper bound the way margin did — a 500% markup is a normal price", () => {
    expect(clientUnitCostForMarkup(8000, 1000, 500)).toBe(48);
  });

  it("returns null when there is no client qty to spread the total across", () => {
    expect(clientUnitCostForMarkup(8000, 0, 25)).toBeNull();
  });

  it("returns null when there is no supplier cost, so the caller leaves the price alone", () => {
    // Every price is an undefined ("infinite") markup on a zero cost —
    // there's no single right answer, so we decline rather than zeroing out
    // what was typed.
    expect(clientUnitCostForMarkup(0, 1000, 25)).toBeNull();
  });
});

describe("round-tripping markup <-> price", () => {
  // The property that makes the column safe to type into. Note it is NOT
  // "the markup comes back exactly": the client price is money and has to
  // round to the cent, and on a cheap item at high volume half a cent of
  // unit-price rounding is a real fraction of the price. That is correct
  // behaviour, not drift to be fixed.
  //
  // So the invariant asserted here is the honest one: the priced line lands
  // within the cent-rounding budget of the ideal total. Anything tighter
  // would be asserting that money has more than two decimals.
  const markups = [5, 12.5, 25, 34, 40, 66.7];
  const costs = [9.49, 100, 0.75, 1250.5];

  for (const markupPct of markups) {
    for (const supplierUnitCost of costs) {
      it(`lands within a cent per unit at ${markupPct}% on a R${supplierUnitCost} cost`, () => {
        const qty = 1000;
        const supplierTotal = round2(qty * supplierUnitCost);

        const unitPrice = clientUnitCostForMarkup(supplierTotal, qty, markupPct);
        expect(unitPrice).not.toBeNull();

        const idealClientTotal = supplierTotal * (1 + markupPct / 100);
        const actualClientTotal = round2(qty * unitPrice!);

        // Half a cent per unit is the entire rounding budget available.
        expect(Math.abs(actualClientTotal - idealClientTotal)).toBeLessThanOrEqual(0.005 * qty);
      });
    }
  }

  it("round-trips exactly at the precision the column actually displays", () => {
    // The table renders whole percent, so this is what a user sees round-trip.
    for (const markupPct of [10, 25, 40]) {
      const supplierTotal = 9490;
      const unitPrice = clientUnitCostForMarkup(supplierTotal, 1000, markupPct)!;
      const backAgain = markupPctFromTotals(round2(1000 * unitPrice), supplierTotal)!;
      expect(backAgain.toFixed(0)).toBe(markupPct.toFixed(0));
    }
  });

  it("is exact when the numbers divide cleanly, with no rounding involved", () => {
    const unitPrice = clientUnitCostForMarkup(8000, 1000, 25);
    expect(unitPrice).toBe(10);
    expect(markupPctFromTotals(10000, 8000)).toBe(25);
  });
});

describe("repriceRowToMarkup", () => {
  it("sets the client price so the row lands on the target markup", () => {
    // R9.49 cost x 1000 = R9,490 -> x1.25 = R11,862.50 -> R11.86/unit.
    const result = repriceRowToMarkup(row({ clientUnitCost: 0 }), 9490, 25);
    expect(result.clientUnitCost).toBe(11.86);
  });

  it("prices against the combined cost of every supplier line the client line covers", () => {
    // The real sheets do this constantly: a jacket line is backed by the
    // jacket (R10,115), its branding (R525) and its delivery (R500). The
    // client line has to be priced off all three, not just the first.
    const result = repriceRowToMarkup(row({ clientQty: 35, clientUnitCost: 0 }), 11140, 25);
    expect(result.clientUnitCost).toBe(397.86); // 11140 * 1.25 / 35
    expect(markupPctFromTotals(round2(35 * 397.86), 11140)).toBeCloseTo(25, 1);
  });

  it("handles a supplier selling in packs while the client is billed per unit", () => {
    // 20 packs at R500 = R10,000 of cost, billed as 1000 units at 25% markup.
    const result = repriceRowToMarkup(row({ clientQty: 1000 }), 10000, 25);
    expect(result.clientUnitCost).toBe(12.5);
    expect(markupPctFromTotals(round2(1000 * 12.5), 10000)).toBe(25);
  });

  it("leaves a row untouched when the target can't be hit", () => {
    const noCost = row();
    expect(repriceRowToMarkup(noCost, 0, 25)).toBe(noCost);

    const noClientQty = row({ clientQty: 0 });
    expect(repriceRowToMarkup(noClientQty, 9490, 25)).toBe(noClientQty);
  });

  it("does not mutate the row it was given", () => {
    const original = row({ clientUnitCost: 0 });
    repriceRowToMarkup(original, 9490, 25);
    expect(original.clientUnitCost).toBe(0);
  });
});

describe("markup is measured against the full client price", () => {
  // Until 2026-08-19 these functions took a discountRate and grossed the
  // price up, because Sibanye's 2.5% was believed to reduce client revenue.
  // It doesn't -- it is a cost on the expense side of the sheet -- so a
  // line's markup is simply profit over the supplier cost behind it. These
  // tests are what would catch a grossing-up factor creeping back in.
  it("prices a line to the target with no adjustment of any kind", () => {
    expect(clientUnitCostForMarkup(8000, 1000, 25)).toBe(10);
    expect(clientUnitCostForMarkup(80, 1, 25)).toBe(100);
  });

  it("reads back exactly the markup it was priced to", () => {
    const unitPrice = clientUnitCostForMarkup(8000, 1000, 25)!;
    expect(markupPctFromTotals(round2(1000 * unitPrice), 8000)).toBe(25);
  });

  it("is the same price for a Sibanye line as for any other", () => {
    // No customer-dependent pricing left in this module at all.
    expect(clientUnitCostForMarkup(9490, 1000, 25)).toBe(11.86);
  });

  it("decimal/fractional target markups are accepted", () => {
    const unitPrice = clientUnitCostForMarkup(8000, 1000, 20.5);
    expect(unitPrice).not.toBeNull();
    expect(markupPctFromTotals(round2(1000 * unitPrice!), 8000)).toBeCloseTo(20.5, 0);
  });
});

describe("maxSupplierTotalForMarkup", () => {
  it("says what you can spend to still clear the target on a known client price", () => {
    // The mine will pay R100,000 and we want a 25% markup -> spend at most R80,000.
    expect(maxSupplierTotalForMarkup(100000, 25)).toBe(80000);
  });

  it("is the exact inverse of pricing up from that cost", () => {
    const budget = maxSupplierTotalForMarkup(100000, 25);
    expect(clientUnitCostForMarkup(budget!, 1, 25)).toBe(100000);
  });

  it("returns null when there is no client price to work back from", () => {
    expect(maxSupplierTotalForMarkup(0, 25)).toBeNull();
  });
});
