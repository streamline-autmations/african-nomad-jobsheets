import { describe, expect, it } from "vitest";
import {
  applyVat,
  calculateJobSheetFinancials,
  calculateLinesSubtotal,
  exclVat,
  inclVat,
  round2,
  sibanyeRebateRateFor,
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

describe("sibanyeRebateRateFor", () => {
  it("is the Sibanye rate only for African Nomad + a Sibanye Stillwater customer", () => {
    expect(sibanyeRebateRateFor("African Nomad", "Sibanye Stillwater")).toBe(0.025);
    expect(sibanyeRebateRateFor("African Nomad", "Sibanye Stillwater East 3")).toBe(0.025);
  });

  it("is zero for any other company or customer combination", () => {
    expect(sibanyeRebateRateFor("Tuscany SA", "Sibanye Stillwater")).toBe(0);
    expect(sibanyeRebateRateFor("African Nomad", "Some Other Mine")).toBe(0);
    expect(sibanyeRebateRateFor("African Nomad", "Sibanye Platinum")).toBe(0);
  });
});

describe("applyVat", () => {
  it("charges VAT on the full subtotal", () => {
    const result = applyVat(10000);
    expect(result.vatAmount).toBe(1500);
    expect(result.total).toBe(11500);
  });

  it("is the exact sequence calculateJobSheetFinancials and calculateNsaQuoteTotals both rely on", () => {
    // Regression anchor: if this function ever changes, both callers move
    // together instead of drifting apart from a one-sided edit.
    const financials = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [],
    });
    const direct = applyVat(10000);
    expect(direct.vatAmount).toBe(financials.vatAmount);
    expect(direct.total).toBe(financials.clientTotal);
  });

  it("never deducts anything before VAT, even on a Sibanye job", () => {
    // The whole point of the 2026-08-19 correction: the client is billed the
    // full subtotal. If a discount-before-VAT ever creeps back in, this fails.
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [],
    });
    expect(result.vatAmount).toBe(1500);
    expect(result.clientTotal).toBe(11500);
  });
});

// ---------------------------------------------------------------------------
// The two real Excel job sheets, pinned as fixtures.
//
// These are the acceptance criteria for the whole cascade: every number below
// is read straight out of the workbooks the team actually works in, and the
// NSA-fee and profit figures in particular are *literal cell values* from
// those sheets, not numbers this app derived. If the cascade is ever changed
// and these still pass, it agrees with the spreadsheet; if they fail, it
// doesn't. Nothing else in this file is as load-bearing.
// ---------------------------------------------------------------------------
describe("calculateJobSheetFinancials — the real Excel job sheets", () => {
  it('reproduces "Jobsheet 2pc travel bag + backpack.xlsx" to the cent', () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater Kloof",
      // ChaseImport!C11:E11 — the sheet has a single client line.
      clientLines: [line("Travelbag", 1230, 287.5)],
      // ChaseImport!J11:Q13 — supplier rows only. The sheet's own "NSA 10%"
      // and "Sibanye 2.5%" rows are excluded: this app derives both.
      expenseLines: [
        line("Travelbag", 1230, 235),
        line("Backpack", 1230, 0),
        line("Delivery", 1, 1500),
      ],
    });

    expect(result.clientSubtotal).toBe(353625); // G52 "Sub Total:"
    expect(result.vatAmount).toBe(53043.75); // G55 "Vat @ 15%"
    expect(result.clientTotal).toBe(406668.75); // G56 "Total (Incl Vat)"
    expect(result.expenseTotal).toBe(290550);
    expect(result.sibanyeRebate).toBe(10166.72); // P15, = G56 * 2.5%
    expect(result.grossProfit).toBe(52908.28);
    expect(result.nsaFee).toBe(5290.83); // P14, a literal value in the sheet
    expect(result.totalCosts).toBe(306007.55); // Q52 "Total Expenses:"
    expect(result.netProfit).toBe(47617.45); // Q53 "Profit:"
    expect(result.netMarginPct).toBe(13.47); // Q54 "Profit Margin"
  });

  it('reproduces "Jobsheet Rowland Cup a Soup project.xlsx" to the cent', () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater Rowland Shaft",
      // ChaseImport!C13:E22 — eight client lines.
      clientLines: [
        line("Take away cups & Lids", 2400, 3),
        line("Cup a soup", 2400, 10),
        line("Setup", 1, 5440),
        line("Delivery", 1, 750),
        line("Black Puffer Jacket + 2 position embroidery", 35, 475),
        line("Delivery", 1, 500),
        line("Black 180g Long Sleeve T-Shirts + 2 position embroidery", 410, 175),
        line("Delivery", 1, 500),
      ],
      // ChaseImport!J13:Q25 — thirteen supplier rows against those eight client
      // lines. Note the jacket and t-shirt lines each carry their own branding
      // and delivery rows: one client line, several supplier lines. Again the
      // sheet's "NSA 10%" and "Sibanye 2.5%" rows are excluded as derived.
      expenseLines: [
        line("Take away cups & Lids", 2400, 2.0701),
        line("Cup a soup", 2400, 5.58),
        line("Setup", 1, 5440),
        line("Delivery", 1, 750),
        line("Black Puffer Jacket + 2 position embroidery", 35, 289),
        line("Branding", 35, 15),
        line("Delivery", 1, 500),
        line("Black 180g Long Sleeve T-Shirts + 2 position embroidery", 410, 77.89),
        line("Branding", 410, 15),
        line("Delivery", 1, 500),
        line("issuing system", 1, 2000),
        line("casual", 1, 3000),
        line("Accommodation", 1, 7100),
      ],
    });

    expect(result.clientSubtotal).toBe(126765); // G64 "Sub Total:"
    expect(result.vatAmount).toBe(19014.75); // G67 "Vat @ 15%"
    expect(result.clientTotal).toBe(145779.75); // G68 "Total (Incl Vat)"
    expect(result.expenseTotal).toBe(86375.14);
    expect(result.sibanyeRebate).toBe(3644.49); // P26, = G68 * 2.5%
    expect(result.grossProfit).toBe(36745.37);
    expect(result.nsaFee).toBe(3674.54); // P27, a literal value in the sheet
    expect(result.totalCosts).toBe(93694.17); // Q64 "Total Expenses:"
    expect(result.netProfit).toBe(33070.83); // Q65 "Profit:"
    expect(result.netMarginPct).toBe(26.09); // Q66 "Profit Margin"
  });
});

describe("calculateJobSheetFinancials — the Sibanye 2.5% is a cost, not a discount", () => {
  it("bills the client the full subtotal and carries the 2.5% as an expense", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [line("Food cost", 1, 4000)],
    });

    // The client's side is untouched by the rebate.
    expect(result.clientSubtotal).toBe(10000);
    expect(result.vatAmount).toBe(1500);
    expect(result.clientTotal).toBe(11500);

    // The rebate is 2.5% of the VAT-INCLUSIVE total, and it lands on our side.
    expect(result.sibanyeRebate).toBe(287.5); // 11500 * 2.5%
    expect(result.grossProfit).toBe(5712.5); // 10000 - 4000 - 287.5
    expect(result.totalCosts).toBe(4858.75); // 4000 + 287.5 + 571.25
  });

  it("takes the rebate off before working out the 10% fee", () => {
    // The ordering the Excel proves (its literal NSA-fee cells only reconcile
    // this way round). If the fee were taken on the pre-rebate profit it would
    // be 600, not 571.25.
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [line("Food cost", 1, 4000)],
    });

    expect(result.nsaFee).toBe(571.25); // 5712.5 * 10%
    expect(result.netProfit).toBe(5141.25); // 5712.5 - 571.25
  });

  it("is calculated on the incl-VAT total, not the subtotal", () => {
    // 10000 * 2.5% would be 250. The sheets use 287.5.
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [],
    });

    expect(result.sibanyeRebate).toBe(287.5);
    expect(result.sibanyeRebate).not.toBe(250);
  });
});

describe("calculateJobSheetFinancials — multi-line", () => {
  it("sums multiple client and expense lines before applying the cascade", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Some Other Mine",
      clientLines: [line("Boots", 10, 450), line("Hats", 10, 180), line("Packs", 10, 93.5)],
      expenseLines: [line("Boots cost", 10, 300), line("Hats cost", 10, 100)],
    });

    // clientSubtotal = 4500 + 1800 + 935 = 7235
    expect(result.clientSubtotal).toBe(7235);
    expect(result.vatAmount).toBe(round2(7235 * 0.15));
    expect(result.expenseTotal).toBe(4000); // 3000 + 1000
    expect(result.grossProfit).toBe(round2(7235 - 4000));
    expect(result.nsaFee).toBe(round2(result.grossProfit * 0.1));
  });

  it("sums multiple lines and still applies the Sibanye rebate once, on the combined total", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Boots", 10, 450), line("Hats", 10, 180), line("Packs", 10, 93.5)],
      expenseLines: [],
    });

    expect(result.clientSubtotal).toBe(7235);
    expect(result.sibanyeRebate).toBe(round2(7235 * 1.15 * 0.025));
    expect(result.vatAmount).toBe(round2(7235 * 0.15));
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
    expect(result.sibanyeRebate).toBe(0);
    expect(result.tuscanyFee).toBe(0);
    expect(result.totalFees).toBe(600);
    expect(result.netProfit).toBe(5400); // 6000 - 600
    expect(result.netMarginPct).toBe(54); // 5400 / 10000 * 100
    expect(result.totalCosts).toBe(4600); // 4000 + 0 + 600
  });

  it("matches the Sibanye customer name case-insensitively and trims whitespace", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "  sibanye stillwater  ",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [],
    });

    expect(result.sibanyeRebate).toBeGreaterThan(0);
  });

  it("applies the Sibanye rebate to a mine/site customer under the Sibanye Stillwater name", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater East 3",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [],
    });

    expect(result.sibanyeRebate).toBe(287.5); // 11500 * 2.5%
  });

  it("does not apply the Sibanye rebate to a customer with a similar but different name", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Platinum",
      clientLines: [line("Catering", 1, 10000)],
      expenseLines: [],
    });

    expect(result.sibanyeRebate).toBe(0);
  });
});

describe("calculateJobSheetFinancials — Tuscany SA", () => {
  it("charges only the 10% silent-partner fee, never NSA fees or the Sibanye rebate", () => {
    const result = calculateJobSheetFinancials({
      companyName: "Tuscany SA",
      customerName: "Any Customer",
      clientLines: [line("Gifting", 1, 8000)],
      expenseLines: [line("Product cost", 1, 3000)],
    });

    expect(result.grossProfit).toBe(5000);
    expect(result.tuscanyFee).toBe(500); // 5000 * 10%
    expect(result.nsaFee).toBe(0);
    expect(result.sibanyeRebate).toBe(0);
    expect(result.totalFees).toBe(500);
    expect(result.netProfit).toBe(4500);
  });

  it("never applies the Sibanye rebate under Tuscany SA, even for that customer", () => {
    const result = calculateJobSheetFinancials({
      companyName: "Tuscany SA",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Gifting", 1, 8000)],
      expenseLines: [],
    });

    expect(result.sibanyeRebate).toBe(0);
    expect(result.tuscanyFee).toBe(800); // 8000 * 10%
  });
});

describe("calculateJobSheetFinancials — margin", () => {
  it("reports the real margin on a thin job without flagging or blocking it", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Some Customer",
      clientLines: [line("Job", 1, 10000)],
      expenseLines: [line("Cost", 1, 8500)],
    });

    expect(result.profitMarginPct).toBe(15);
    expect(result.netMarginPct).toBe(13.5); // 1350 / 10000
  });

  it("reports a loss-making job sheet as a negative margin without throwing", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Some Customer",
      clientLines: [line("Job", 1, 5000)],
      expenseLines: [line("Cost", 1, 8000)],
    });

    expect(result.grossProfit).toBe(-3000);
    expect(result.profitMarginPct).toBe(-60);
    // No fee is taken on a loss — NSA shares profit, not losses.
    expect(result.nsaFee).toBe(0);
    expect(result.netProfit).toBe(-3000);
  });

  it("rounds a loss away from zero, like any other money value", () => {
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(-2.675)).toBe(-2.68);
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

  it("still carries expenses and a margin when there are costs but no client lines yet", () => {
    const result = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater",
      clientLines: [],
      expenseLines: [line("Deposit paid", 1, 500)],
    });

    expect(result.sibanyeRebate).toBe(0); // nothing invoiced yet, so nothing to rebate
    expect(result.grossProfit).toBe(-500);
    expect(result.totalCosts).toBe(500); // 500 + 0 + 0 — no fee on a loss
  });

  it("applies no fee at all for a company name outside the known two", () => {
    const result = calculateJobSheetFinancials({
      companyName: "Some Future Entity",
      customerName: "Sibanye Stillwater",
      clientLines: [line("Job", 1, 10000)],
      expenseLines: [],
    });

    expect(result.nsaFee).toBe(0);
    expect(result.sibanyeRebate).toBe(0);
    expect(result.tuscanyFee).toBe(0);
    expect(result.totalFees).toBe(0);
    expect(result.netProfit).toBe(result.grossProfit);
  });
});
