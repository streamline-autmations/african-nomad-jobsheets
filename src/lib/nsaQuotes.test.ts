import { describe, expect, it } from "vitest";
import { calculateNsaQuoteTotals } from "./nsaQuotes";
import { calculateJobSheetFinancials, withLineTotal } from "./feeCalculations";
import type { LineItem, LineItemInput } from "../types";

function lines(...specs: Array<[string, number, number]>): LineItem[] {
  return specs.map(([description, qty, unitCost], i) =>
    withLineTotal({ id: `l${i}`, description, qty, unitCost } as LineItemInput),
  );
}

describe("calculateNsaQuoteTotals", () => {
  it("matches the real reference quote with no discount", () => {
    // Quote 1291 to Harmony Kalgold: 800 x R335 = R268,000 + R40,200 VAT.
    const totals = calculateNsaQuoteTotals(lines(["Beanies", 800, 335]));
    expect(totals).toEqual({
      subtotal: 268000,
      discountAmount: 0,
      vatAmount: 40200,
      total: 308200,
    });
  });

  it("charges VAT on the full subtotal and reports no discount", () => {
    // Corrected 2026-08-19: Sibanye's 2.5% is a cost AN carries, not a
    // reduction of what the client is billed, so it must not appear on the
    // client's document or in its arithmetic. There is no longer any way to
    // pass one in — a discount that the totals beside it don't reflect is
    // exactly how these two documents disagreed once before.
    const totals = calculateNsaQuoteTotals(lines(["PPE", 1, 100000]));
    expect(totals.subtotal).toBe(100000);
    expect(totals.discountAmount).toBe(0);
    // VAT on the full 100,000 -- not on 97,500.
    expect(totals.vatAmount).toBe(15000);
    expect(totals.total).toBe(115000);
  });

  it("matches the real reference invoice", () => {
    // Invoice NSA06384 to Christo Naude: 16 beanies at R70 = R1,120 + R168 VAT.
    const totals = calculateNsaQuoteTotals(
      lines(["Beanies - Pink", 1, 70], ["Beanies - Yellow", 1, 70], ["Beanies - Khaki", 14, 70]),
    );
    expect(totals.subtotal).toBe(1120);
    expect(totals.vatAmount).toBe(168);
    expect(totals.total).toBe(1288);
  });

  it("always reports a zero discount", () => {
    expect(calculateNsaQuoteTotals(lines(["Widget", 2, 50])).discountAmount).toBe(0);
  });
});

describe("the NSA quote agrees with the job sheet it came from", () => {
  // The invariant: the mine's document and AN's internal sheet must always
  // show the same client total. It used to be possible to break this by
  // discounting one side and not the other -- a R10,400.31 gap on one live job
  // sheet. Since 2026-08-19 neither side discounts anything, which makes the
  // invariant simpler, not less important: these tests are what would catch a
  // discount creeping back into either one alone.
  const clientLines = lines(
    ["Safety boots", 500, 450],
    ["Hard hats", 500, 180],
    ["Induction packs", 500, 93.5],
  );

  it("produces the identical client total for a Sibanye job", () => {
    const financials = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater Rustenburg",
      clientLines,
      expenseLines: lines(["Supplier cost", 1, 200000]),
    });
    // The rebate exists -- it is simply on the cost side, not the client's.
    expect(financials.sibanyeRebate).toBeGreaterThan(0);

    const quote = calculateNsaQuoteTotals(clientLines);

    expect(quote.subtotal).toBe(financials.clientSubtotal);
    expect(quote.vatAmount).toBe(financials.vatAmount);
    expect(quote.total).toBe(financials.clientTotal);
  });

  it("still agrees for a customer with no rebate", () => {
    const financials = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Harmony Kalgold",
      clientLines,
      expenseLines: [],
    });
    expect(financials.sibanyeRebate).toBe(0);

    expect(calculateNsaQuoteTotals(clientLines).total).toBe(financials.clientTotal);
  });

  it("bills a Sibanye job exactly the same as any other customer", () => {
    // The 2.5% must be invisible to the client. A Sibanye job and a
    // non-Sibanye job with identical lines produce identical documents.
    const sibanye = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater Rustenburg",
      clientLines,
      expenseLines: [],
    });
    const other = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Harmony Kalgold",
      clientLines,
      expenseLines: [],
    });

    expect(sibanye.clientTotal).toBe(other.clientTotal);
    expect(calculateNsaQuoteTotals(clientLines).total).toBe(sibanye.clientTotal);
    // ...but the two sheets do not make the same profit.
    expect(sibanye.netProfit).toBeLessThan(other.netProfit);
  });
});
