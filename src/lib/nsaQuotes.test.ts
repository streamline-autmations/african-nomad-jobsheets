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

  it("applies a discount before VAT, so VAT is charged on the reduced amount", () => {
    const totals = calculateNsaQuoteTotals(lines(["PPE", 1, 100000]), 2500);
    expect(totals.subtotal).toBe(100000);
    expect(totals.discountAmount).toBe(2500);
    // VAT on 97,500 -- not on 100,000.
    expect(totals.vatAmount).toBe(14625);
    expect(totals.total).toBe(112125);
  });

  it("ignores a negative discount rather than inflating the total", () => {
    const totals = calculateNsaQuoteTotals(lines(["Widget", 1, 100]), -50);
    expect(totals.discountAmount).toBe(0);
    expect(totals.total).toBe(115);
  });

  it("defaults to no discount when the argument is omitted", () => {
    expect(calculateNsaQuoteTotals(lines(["Widget", 2, 50])).discountAmount).toBe(0);
  });
});

describe("the NSA quote agrees with the job sheet it came from", () => {
  // The bug this guards against: a job sheet gave Sibanye a 2.5% discount, but
  // the NSA quote -- the only document the mine ever sees -- was raised at full
  // price. AN's books gave away money the client was never billed less for. On
  // one live job sheet that was a R10,400.31 gap.
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
    // Sanity: the fee cascade did apply a discount for this customer.
    expect(financials.sibanyeDiscount).toBeGreaterThan(0);

    const quote = calculateNsaQuoteTotals(clientLines, financials.sibanyeDiscount);

    expect(quote.subtotal).toBe(financials.clientSubtotal);
    expect(quote.discountAmount).toBe(financials.sibanyeDiscount);
    expect(quote.vatAmount).toBe(financials.vatAmount);
    expect(quote.total).toBe(financials.clientTotal);
  });

  it("still agrees for a customer with no discount", () => {
    const financials = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Harmony Kalgold",
      clientLines,
      expenseLines: [],
    });
    expect(financials.sibanyeDiscount).toBe(0);

    const quote = calculateNsaQuoteTotals(clientLines, financials.sibanyeDiscount);
    expect(quote.total).toBe(financials.clientTotal);
  });

  it("would have disagreed if the discount were dropped — the regression itself", () => {
    const financials = calculateJobSheetFinancials({
      companyName: "African Nomad",
      customerName: "Sibanye Stillwater Rustenburg",
      clientLines,
      expenseLines: [],
    });
    const withoutDiscount = calculateNsaQuoteTotals(clientLines);
    expect(withoutDiscount.total).not.toBe(financials.clientTotal);
    expect(withoutDiscount.total).toBeGreaterThan(financials.clientTotal);
  });
});
