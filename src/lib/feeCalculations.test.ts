import { describe, expect, it } from "vitest";
import {
  calculateJobSheetFinancials,
  calculateLinesSubtotal,
  exclVat,
  inclVat,
  round2,
  withLineTotal,
} from "./feeCalculations";
import type { LineItem } from "../types";

function line(description: string, qty: number, unitCost: number): LineItem {
  return withLineTotal({ id: description, description, qty, unitCost });
}

describe("round2", () => {
  it("rounds to two decimal places without binary float drift", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(10.005)).toBe(10.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("inclVat / exclVat", () => {
  it("adds and removes 15% VAT", () => {
    expect(inclVat(100)).toBe(115);
    expect(exclVat(115)).toBe(100);
  });

  it("round-trips through cent rounding", () => {
    // 9.49 * 1.15 = 10.9135 -> rounds to 10.91; going back is not exactly
    // 9.49 because the incl.-VAT figure already lost a fraction of a cent —
    // same rounding-budget reality as the markup round trip.
    const excl = 9.49;
    const incl = inclVat(excl);
    expect(incl).toBe(10.91);
    expect(exclVat(incl)).toBeCloseTo(excl, 1);
  });

  it("is exact when the numbers divide cleanly", () => {
    expect(inclVat(200)).toBe(230);
    expect(exclVat(230)).toBe(200);
  });

  it("treats zero correctly in both directions", () => {
    expect(inclVat(0)).toBe(0);
    expect(exclVat(0)).toBe(0);
  });
});

describe("withLineTotal / calculateLinesSubtotal", () => {
  it("computes qty * unitCost per line and sums the lines", () => {
    const lines = [line("A", 2, 100), line("B", 3, 50)];
    expect(lines[0].lineTotal).toBe(200);
    expect(lines[1].lineTotal).toBe(150);
    expect(calculateLinesSubtotal(lines)).toBe(350);
  });

  it("handles an empty line list as zero", () => {
    expect(calculateLinesSubtotal([])).toBe(0);
  });
});

describe("calculateJobSheetFinancials — African Nomad", () => {
  it("charges only the 10% NSA fee for a non-Sibanye customer", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Some Other Mine",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [line("Food cost", 1, 4000)],
    });

    // clientSubtotal 10000, VAT 1500, clientTotal 11500
    // expenseTotal 4000, grossProfit 6000, margin 60%
    expect(result.clientSubtotal).toBe(10000);
    expect(result.vatAmount).toBe(1500);
    expect(result.clientTotal).toBe(11500);
    expect(result.expenseTotal).toBe(4000);
    expect(result.grossProfit).toBe(6000);
    expect(result.profitMarginPct).toBe(60);

    expect(result.nsaFee).toBe(600); // 6000 * 10%
    expect(result.sibanyeDiscount).toBe(0);
    expect(result.tuscanyFee).toBe(0);
    expect(result.totalFees).toBe(600);
    expect(result.netProfit).toBe(5400); // 6000 - 600
    expect(result.netMarginPct).toBe(54); // 5400 / 10000 * 100
    expect(result.belowMarginTarget).toBe(false);
  });

  it("discounts Sibanye's invoice 2.5% before VAT, which flows through to profit and the 10% NSA fee", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [line("Food cost", 1, 4000)],
    });

    // clientSubtotal 10000, discount 250, discounted subtotal 9750
    // VAT 1462.50, clientTotal 11212.50
    expect(result.clientSubtotal).toBe(10000);
    expect(result.sibanyeDiscount).toBe(250); // 10000 * 2.5%
    expect(result.vatAmount).toBe(1462.5);
    expect(result.clientTotal).toBe(11212.5);

    expect(result.grossProfit).toBe(5750); // 9750 - 4000
    expect(result.nsaFee).toBe(575); // 5750 * 10%
    expect(result.tuscanyFee).toBe(0);
    expect(result.totalFees).toBe(575);
    expect(result.netProfit).toBe(5175); // 5750 - 575
  });

  it("matches the Sibanye customer name case-insensitively and trims whitespace", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "  sibanye stillwater  ",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [],
    });

    expect(result.sibanyeDiscount).toBeGreaterThan(0);
  });

  it("applies the Sibanye discount to a mine/site customer under the Sibanye Stillwater name", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater East 3",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [],
    });

    expect(result.sibanyeDiscount).toBe(250); // 10000 * 2.5%
  });

  it("does not apply the Sibanye discount to a customer with a similar but different name", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Platinum",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [],
    });

    expect(result.sibanyeDiscount).toBe(0);
  });

});

describe("calculateJobSheetFinancials — Tuscany SA", () => {
  it("charges only the 10% silent-partner fee, never NSA fees or the Sibanye discount", () => {
    const result = calculateJobSheetFinancials({
      companyName: "Tuscany SA",
      customerName: "Any Customer",
      clientLines: [line("Gifting", 1, 8000)],
      expenseLines: [line("Product cost", 1, 3000)],
    });

    expect(result.grossProfit).toBe(5000);
    expect(result.tuscanyFee).toBe(500); // 5000 * 10%
    expect(result.nsaFee).toBe(0);
    expect(result.sibanyeDiscount).toBe(0);
    expect(result.totalFees).toBe(500);
    expect(result.netProfit).toBe(4500);
  });

  it("never applies the Sibanye discount under Tuscany SA, even for that customer", () => {
    const result = calculateJobSheetFinancials({
      companyName: "Tuscany SA",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Gifting", 1, 8000)],
      expenseLines: [],
    });

    expect(result.sibanyeDiscount).toBe(0);
    expect(result.tuscanyFee).toBe(800); // 8000 * 10%
  });
});

describe("calculateJobSheetFinancials — margin flag", () => {
  it("flags gross margin below the 20% target without blocking the numbers", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Some Customer",
      clientLines: [line("Job", 1, 10000)],
      expenseLines: [line("Cost", 1, 8500)], // 15% margin
    });

    expect(result.profitMarginPct).toBe(15);
    expect(result.belowMarginTarget).toBe(true);
  });

  it("does not flag a margin at exactly the 20% target", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Some Customer",
      clientLines: [line("Job", 1, 10000)],
      expenseLines: [line("Cost", 1, 8000)], // exactly 20% margin
    });

    expect(result.profitMarginPct).toBe(20);
    expect(result.belowMarginTarget).toBe(false);
  });

  it("flags a loss-making job sheet (negative margin) without throwing", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Some Customer",
      clientLines: [line("Job", 1, 5000)],
      expenseLines: [line("Cost", 1, 8000)],
    });

    expect(result.grossProfit).toBe(-3000);
    expect(result.profitMarginPct).toBe(-60);
    expect(result.belowMarginTarget).toBe(true);
    expect(result.nsaFee).toBe(-300); // fee math applies to a negative gross profit too
  });
});

describe("calculateJobSheetFinancials — edge cases", () => {
  it("does not divide by zero when there are no client lines yet", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "",
      clientLines: [],
      expenseLines: [],
    });

    expect(result.clientSubtotal).toBe(0);
    expect(result.profitMarginPct).toBe(0);
    expect(result.netMarginPct).toBe(0);
    expect(Number.isNaN(result.profitMarginPct)).toBe(false);
  });

  it("applies no fee at all for a company name outside the known two", () => {
    const result = calculateJobSheetFinancials({
      companyName: "Some Future Entity",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Job", 1, 10000)],
      expenseLines: [],
    });

    expect(result.nsaFee).toBe(0);
    expect(result.sibanyeDiscount).toBe(0);
    expect(result.tuscanyFee).toBe(0);
    expect(result.totalFees).toBe(0);
    expect(result.netProfit).toBe(result.grossProfit);
  });
});
