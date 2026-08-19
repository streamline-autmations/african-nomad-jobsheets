import { describe, expect, it } from "vitest";
import {
  clientUnitCostForMargin,
  marginPctFromTotals,
  maxSupplierTotalForMargin,
  repriceRowToMargin,
} from "./markup";
import { round2 } from "./feeCalculations";
import type { RepriceableRow } from "./markup";

function row(overrides: Partial<RepriceableRow> = {}): RepriceableRow {
  return { clientQty: 1000, clientUnitCost: 30.74, ...overrides };
}

describe("marginPctFromTotals", () => {
  it("matches the formula the table has always displayed", () => {
    // R268,000 charged against R200,000 of cost = 25.37% margin.
    expect(marginPctFromTotals(268000, 200000)).toBe(25.37);
  });

  it("is 100% when a line has no tracked supplier cost", () => {
    expect(marginPctFromTotals(500, 0)).toBe(100);
  });

  it("goes negative when a line is being sold at a loss", () => {
    expect(marginPctFromTotals(100, 150)).toBe(-50);
  });

  it("returns null rather than dividing by zero on a blank or supplier-only row", () => {
    expect(marginPctFromTotals(0, 0)).toBeNull();
    expect(marginPctFromTotals(0, 250)).toBeNull();
  });
});

describe("clientUnitCostForMargin", () => {
  it("prices a line to hit the 20% target", () => {
    // R8,000 of cost over 1000 units, kept at 20% margin -> R10,000 -> R10/unit.
    expect(clientUnitCostForMargin(8000, 1000, 20)).toBe(10);
  });

  it("refuses margins of 100% or more, which would need an infinite price", () => {
    expect(clientUnitCostForMargin(8000, 1000, 100)).toBeNull();
    expect(clientUnitCostForMargin(8000, 1000, 150)).toBeNull();
  });

  it("returns null when there is no client qty to spread the total across", () => {
    expect(clientUnitCostForMargin(8000, 0, 20)).toBeNull();
  });

  it("returns null when there is no supplier cost, so the caller leaves the price alone", () => {
    // Every price is "100% margin" against a zero cost — there's no single
    // right answer, so we decline rather than zeroing out what was typed.
    expect(clientUnitCostForMargin(0, 1000, 20)).toBeNull();
  });
});

describe("round-tripping margin <-> price", () => {
  // The property that makes the column safe to type into. Note it is NOT
  // "the margin comes back exactly": the client price is money and has to
  // round to the cent, and on a cheap item at high volume half a cent of
  // unit-price rounding is a real fraction of the price. (R0.75 cost, qty
  // 1000, 20% target -> the ideal R0.9375/unit rounds to R0.94, which lands
  // on 20.21%.) That is correct behaviour, not drift to be fixed.
  //
  // So the invariant asserted here is the honest one: the priced line lands
  // within the cent-rounding budget of the ideal total. Anything tighter
  // would be asserting that money has more than two decimals.
  const margins = [5, 12.5, 20, 25.37, 40, 66.7];
  const costs = [9.49, 100, 0.75, 1250.5];

  for (const marginPct of margins) {
    for (const supplierUnitCost of costs) {
      it(`lands within a cent per unit at ${marginPct}% on a R${supplierUnitCost} cost`, () => {
        const qty = 1000;
        const supplierTotal = round2(qty * supplierUnitCost);

        const unitPrice = clientUnitCostForMargin(supplierTotal, qty, marginPct);
        expect(unitPrice).not.toBeNull();

        const idealClientTotal = supplierTotal / (1 - marginPct / 100);
        const actualClientTotal = round2(qty * unitPrice!);

        // Half a cent per unit is the entire rounding budget available.
        expect(Math.abs(actualClientTotal - idealClientTotal)).toBeLessThanOrEqual(0.005 * qty);
      });
    }
  }

  it("round-trips exactly at the precision the column actually displays", () => {
    // The table renders whole percent, so this is what a user sees round-trip.
    for (const marginPct of [10, 20, 25, 40]) {
      const supplierTotal = 9490;
      const unitPrice = clientUnitCostForMargin(supplierTotal, 1000, marginPct)!;
      const backAgain = marginPctFromTotals(round2(1000 * unitPrice), supplierTotal)!;
      expect(backAgain.toFixed(0)).toBe(marginPct.toFixed(0));
    }
  });

  it("is exact when the numbers divide cleanly, with no rounding involved", () => {
    const unitPrice = clientUnitCostForMargin(8000, 1000, 20);
    expect(unitPrice).toBe(10);
    expect(marginPctFromTotals(10000, 8000)).toBe(20);
  });
});

describe("repriceRowToMargin", () => {
  it("sets the client price so the row lands on the target margin", () => {
    // R9.49 cost x 1000 = R9,490 -> /0.8 = R11,862.50 -> R11.86/unit.
    const result = repriceRowToMargin(row({ clientUnitCost: 0 }), 9490, 20);
    expect(result.clientUnitCost).toBe(11.86);
  });

  it("prices against the combined cost of every supplier line the client line covers", () => {
    // The real sheets do this constantly: a jacket line is backed by the
    // jacket (R10,115), its branding (R525) and its delivery (R500). The
    // client line has to be priced off all three, not just the first.
    const result = repriceRowToMargin(row({ clientQty: 35, clientUnitCost: 0 }), 11140, 20);
    expect(result.clientUnitCost).toBe(397.86); // 11140 / 0.8 / 35
    expect(marginPctFromTotals(round2(35 * 397.86), 11140)).toBeCloseTo(20, 1);
  });

  it("handles a supplier selling in packs while the client is billed per unit", () => {
    // 20 packs at R500 = R10,000 of cost, billed as 1000 units at 20% margin.
    const result = repriceRowToMargin(row({ clientQty: 1000 }), 10000, 20);
    expect(result.clientUnitCost).toBe(12.5);
    expect(marginPctFromTotals(round2(1000 * 12.5), 10000)).toBe(20);
  });

  it("leaves a row untouched when the target can't be hit", () => {
    const noCost = row();
    expect(repriceRowToMargin(noCost, 0, 20)).toBe(noCost);

    const noClientQty = row({ clientQty: 0 });
    expect(repriceRowToMargin(noClientQty, 9490, 20)).toBe(noClientQty);
  });

  it("does not mutate the row it was given", () => {
    const original = row({ clientUnitCost: 0 });
    repriceRowToMargin(original, 9490, 20);
    expect(original.clientUnitCost).toBe(0);
  });
});

describe("margin is measured against the full client price", () => {
  // Until 2026-08-19 these functions took a discountRate and grossed the price
  // up, because Sibanye's 2.5% was believed to reduce client revenue. It
  // doesn't -- it is a cost on the expense side of the sheet -- so a line's
  // margin is simply profit over the price the mine is actually billed. These
  // tests are what would catch a grossing-up factor creeping back in.
  it("prices a line to the target with no adjustment of any kind", () => {
    expect(clientUnitCostForMargin(8000, 1000, 20)).toBe(10);
    expect(clientUnitCostForMargin(80, 1, 20)).toBe(100);
  });

  it("reads back exactly the margin it was priced to", () => {
    const unitPrice = clientUnitCostForMargin(8000, 1000, 20)!;
    expect(marginPctFromTotals(round2(1000 * unitPrice), 8000)).toBe(20);
  });

  it("is the same price for a Sibanye line as for any other", () => {
    // No customer-dependent pricing left in this module at all.
    expect(clientUnitCostForMargin(9490, 1000, 20)).toBe(11.86);
  });

  it("decimal/fractional target margins are accepted", () => {
    const unitPrice = clientUnitCostForMargin(8000, 1000, 20.5);
    expect(unitPrice).not.toBeNull();
    expect(marginPctFromTotals(round2(1000 * unitPrice!), 8000)).toBeCloseTo(20.5, 0);
  });
});

describe("maxSupplierTotalForMargin", () => {
  it("says what you can spend to still clear the target on a known client price", () => {
    // The mine will pay R100,000 and we want 20% -> spend at most R80,000.
    expect(maxSupplierTotalForMargin(100000, 20)).toBe(80000);
  });

  it("is the exact inverse of pricing up from that cost", () => {
    const budget = maxSupplierTotalForMargin(100000, 20);
    expect(clientUnitCostForMargin(budget!, 1, 20)).toBe(100000);
  });

  it("returns null when there is no client price to work back from", () => {
    expect(maxSupplierTotalForMargin(0, 20)).toBeNull();
  });
});
