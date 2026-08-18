import { describe, expect, it } from "vitest";
import {
  clientUnitCostForMargin,
  marginPctFromTotals,
  maxSupplierTotalForMargin,
  repriceRowToMargin,
} from "./markup";
import { round2 } from "./feeCalculations";
import type { PairedRow } from "./pairedLineItems";

function row(overrides: Partial<PairedRow> = {}): PairedRow {
  return {
    id: "r1",
    description: "Lanyard",
    clientQty: 1000,
    clientUnitCost: 30.74,
    vendorName: "",
    supplierQty: 1000,
    supplierUnitCost: 9.49,
    ...overrides,
  };
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
    const result = repriceRowToMargin(row({ clientUnitCost: 0 }), 20);
    // R9.49 cost x 1000 = R9,490 -> /0.8 = R11,862.50 -> R11.86/unit.
    expect(result.clientUnitCost).toBe(11.86);
  });

  it("handles a supplier selling in packs while the client is billed per unit", () => {
    // 20 packs at R500 = R10,000 of cost, billed as 1000 units at 20% margin.
    const result = repriceRowToMargin(
      row({ clientQty: 1000, supplierQty: 20, supplierUnitCost: 500 }),
      20,
    );
    expect(result.clientUnitCost).toBe(12.5);
    expect(marginPctFromTotals(round2(1000 * 12.5), 10000)).toBe(20);
  });

  it("leaves a row untouched when the target can't be hit", () => {
    const noCost = row({ supplierUnitCost: 0, supplierQty: 0 });
    expect(repriceRowToMargin(noCost, 20)).toBe(noCost);

    const noClientQty = row({ clientQty: 0 });
    expect(repriceRowToMargin(noClientQty, 20)).toBe(noClientQty);
  });

  it("does not mutate the row it was given", () => {
    const original = row({ clientUnitCost: 0 });
    repriceRowToMargin(original, 20);
    expect(original.clientUnitCost).toBe(0);
  });
});

describe("Sibanye-discount-aware repricing", () => {
  // The bug: repriceRowToMargin used to price a line to "20%" purely from its
  // own supplier/client totals, with no idea a 2.5% sheet-level discount was
  // about to come off the top. A line "priced to 20%" on a Sibanye/African
  // Nomad job then actually netted ~17.95% once the discount applied — the
  // exact bug class that already cost ~R10,400 once on the NSA-document side.
  // These tests prove discountRate closes that gap.
  const SIBANYE_RATE = 0.025;

  it("without a discount rate, behaves exactly as before (default stays 0)", () => {
    expect(clientUnitCostForMargin(8000, 1000, 20)).toBe(10);
  });

  it("grosses the price up so the post-discount revenue still hits the target margin", () => {
    // R80 cost, 20% target, 2.5% discount: post-discount revenue needed is
    // 80 / 0.8 = 100; pre-discount sticker price is 100 / 0.975 = 102.5641...
    const unitPrice = clientUnitCostForMargin(80, 1, 20, SIBANYE_RATE);
    expect(unitPrice).toBe(102.56);

    // Confirm the real-world effect: net revenue after the discount clears 20%.
    const netRevenue = unitPrice! * (1 - SIBANYE_RATE);
    const actualMargin = ((netRevenue - 80) / netRevenue) * 100;
    expect(actualMargin).toBeCloseTo(20, 0);
  });

  it("reproduces the worked example from AN_JOBSHEET_SYSTEM_CONTEXT.md: undiscounted pricing under-delivers", () => {
    // R80 cost priced to 20% with NO discount awareness gives R100 — but once
    // the 2.5% discount comes off, actual margin is ~17.95%, not 20%.
    const naivePrice = clientUnitCostForMargin(80, 1, 20); // discountRate defaults to 0
    expect(naivePrice).toBe(100);
    const netRevenue = naivePrice! * (1 - SIBANYE_RATE);
    const actualMargin = ((netRevenue - 80) / netRevenue) * 100;
    expect(actualMargin).toBeCloseTo(17.95, 1);
  });

  it("repriceRowToMargin threads the discount rate through to the row", () => {
    const result = repriceRowToMargin(row({ clientUnitCost: 0 }), 20, SIBANYE_RATE);
    expect(result.clientUnitCost).toBeGreaterThan(11.86); // more than the no-discount price
  });

  it("marginPctFromTotals with a discount rate reads back what repriceRowToMargin targeted", () => {
    const unitPrice = clientUnitCostForMargin(8000, 1000, 20, SIBANYE_RATE)!;
    const clientTotal = round2(1000 * unitPrice);
    const displayedMargin = marginPctFromTotals(clientTotal, 8000, SIBANYE_RATE)!;
    expect(displayedMargin).toBeCloseTo(20, 0);
  });

  it("a discountRate of 1 or more is refused rather than dividing by zero", () => {
    expect(clientUnitCostForMargin(8000, 1000, 20, 1)).toBeNull();
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
