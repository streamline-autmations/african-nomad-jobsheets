import { describe, expect, it } from "vitest";
import { pickVatTaxCodeId, rateInForce } from "./vatTaxCode.js";

const TODAY = "2026-10-05";

function code(Id: string, Name: string, ...rateIds: string[]) {
  return {
    Id,
    Name,
    SalesTaxRateList: { TaxRateDetail: rateIds.map((value) => ({ TaxRateRef: { value } })) },
  };
}

describe("rateInForce", () => {
  it("uses RateValue when the rate has no history", () => {
    expect(rateInForce({ RateValue: "15" }, TODAY)).toBe(15);
  });

  it("uses the history entry covering today, not the top-level RateValue", () => {
    const rate = {
      RateValue: 14,
      EffectiveTaxRate: [
        { RateValue: 14, EffectiveDate: "1900-01-01", EndDate: "2018-03-31" },
        { RateValue: 15, EffectiveDate: "2018-04-01" },
      ],
    };
    expect(rateInForce(rate, TODAY)).toBe(15);
    expect(rateInForce(rate, "2018-03-31")).toBe(14);
  });

  it("handles QBO datetime-style dates", () => {
    const rate = {
      RateValue: 14,
      EffectiveTaxRate: [{ RateValue: 15, EffectiveDate: "2018-04-01T00:00:00-07:00" }],
    };
    expect(rateInForce(rate, TODAY)).toBe(15);
  });
});

describe("pickVatTaxCodeId", () => {
  const rates = [
    { Id: "r14", RateValue: 14 },
    { Id: "r15", RateValue: 15 },
    { Id: "r0", RateValue: 0 },
  ];

  it("picks the 15% code even when a 14% code is named Standard Rate", () => {
    const codes = [code("1", "Standard Rate", "r14"), code("2", "Zero Rate", "r0"), code("3", "VAT 15%", "r15")];
    expect(pickVatTaxCodeId(codes, rates, TODAY)).toBe("3");
  });

  it("looks at every sales rate on a code, not just the first", () => {
    const halves = [
      { Id: "a", RateValue: 7.5 },
      { Id: "b", RateValue: 7.5 },
    ];
    expect(pickVatTaxCodeId([code("9", "Split", "a", "b")], halves, TODAY)).toBe("9");
  });

  it("finds a 15% code whose rate was edited from 14% via effective dates", () => {
    const edited = [
      {
        Id: "std",
        RateValue: 14,
        EffectiveTaxRate: [
          { RateValue: 14, EffectiveDate: "1900-01-01", EndDate: "2018-03-31" },
          { RateValue: 15, EffectiveDate: "2018-04-01" },
        ],
      },
    ];
    expect(pickVatTaxCodeId([code("5", "Standard Rate", "std")], edited, TODAY)).toBe("5");
  });

  it("prefers plain Standard Rate over Capital Goods when both are 15%", () => {
    const codes = [code("7", "Standard Rate (Capital Goods)", "r15"), code("8", "Standard Rate", "r15")];
    expect(pickVatTaxCodeId(codes, rates, TODAY)).toBe("8");
  });

  it("throws instead of falling back when nothing charges 15%", () => {
    const codes = [code("1", "Standard Rate", "r14"), code("2", "Zero Rate", "r0"), { Id: "6", Name: "Purchases only" }];
    expect(() => pickVatTaxCodeId(codes, rates, TODAY)).toThrow(
      "Sales tax codes found: Standard Rate (14%), Zero Rate (0%).",
    );
  });

  it("throws when QBO returns no tax codes at all", () => {
    expect(() => pickVatTaxCodeId([], rates, TODAY)).toThrow("Sales tax codes found: none.");
  });

  it("ignores a code whose rate wasn't returned", () => {
    expect(() => pickVatTaxCodeId([code("1", "Standard Rate", "missing")], rates, TODAY)).toThrow(/no active tax code/);
  });
});
