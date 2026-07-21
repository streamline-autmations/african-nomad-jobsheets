import { afterEach, describe, expect, it } from "vitest";
import {
  buildCustomerAdd,
  buildEstimateAdd,
  buildInvoiceAdd,
  buildItemServiceAdd,
  buildBillAdd,
} from "./builders";
import { qbdAmount, qbdJobFullName, qbdName, qbdQuantity, setQbdDecimalSeparator } from "./xml";

const V = "13.0";

describe("qbdName", () => {
  it("caps names at 41 chars and replaces the QBD list separator", () => {
    expect(qbdName("A".repeat(50)).length).toBe(41);
    expect(qbdName("Parent:Child")).toBe("Parent-Child");
  });
});

describe("qbdJobFullName", () => {
  it("joins customer and job with a colon, sanitising each segment separately", () => {
    expect(qbdJobFullName("Harmony", "Solar Torch Delivery")).toBe("Harmony:Solar Torch Delivery");
  });

  it("doesn't let a colon inside either segment corrupt the hierarchy", () => {
    // If the whole joined string were re-sanitised, this colon would also
    // get stripped — qbdJobFullName must sanitise each side before joining.
    expect(qbdJobFullName("Harmony", "Weird:Job")).toBe("Harmony:Weird-Job");
  });
});

describe("qbdAmount / qbdQuantity decimal separator", () => {
  afterEach(() => setQbdDecimalSeparator(".")); // don't leak into other tests

  it("defaults to a period", () => {
    expect(qbdAmount(600)).toBe("600.00");
    expect(qbdQuantity(1.5)).toBe("1.5");
  });

  it("switches to a comma when configured — QBD on an en-ZA machine rejects '600.00' otherwise", () => {
    setQbdDecimalSeparator(",");
    expect(qbdAmount(600)).toBe("600,00");
    expect(qbdQuantity(1.5)).toBe("1,5");
  });
});

describe("buildCustomerAdd", () => {
  it("emits a well-formed CustomerAddRq with the qbxml version header", () => {
    const xml = buildCustomerAdd(V, "0", "Sibanye Stillwater");
    expect(xml).toContain(`<?qbxml version="13.0"?>`);
    expect(xml).toContain(`<CustomerAddRq requestID="0">`);
    expect(xml).toContain(`<Name>Sibanye Stillwater</Name>`);
  });

  it("escapes XML-significant characters in the name", () => {
    const xml = buildCustomerAdd(V, "0", "Tom & Jerry <Pty>");
    expect(xml).toContain("Tom &amp; Jerry &lt;Pty&gt;");
    expect(xml).not.toContain("Tom & Jerry");
  });

  it("adds a ParentRef when creating a Job under a customer", () => {
    const xml = buildCustomerAdd(V, "0", "Solar Torch Delivery", "Harmony");
    expect(xml).toContain("<Name>Solar Torch Delivery</Name>");
    expect(xml).toContain("<ParentRef><FullName>Harmony</FullName></ParentRef>");
  });

  it("omits ParentRef for a plain top-level customer", () => {
    const xml = buildCustomerAdd(V, "0", "Harmony");
    expect(xml).not.toContain("ParentRef");
  });
});

describe("buildEstimateAdd", () => {
  it("renders one EstimateLineAdd per client line, with item ref, desc, qty, rate", () => {
    const xml = buildEstimateAdd(V, "2", {
      customerName: "Sibanye Stillwater",
      memo: "Catering job",
      itemName: "Job Sheet Line",
      lines: [
        { description: "Catering", qty: 2, unitCost: 5000 },
        { description: "Delivery", qty: 1, unitCost: 750.5 },
      ],
    });

    expect(xml).toContain("<CustomerRef><FullName>Sibanye Stillwater</FullName></CustomerRef>");
    expect(xml).toContain("<Memo>Catering job</Memo>");
    expect((xml.match(/<EstimateLineAdd>/g) ?? []).length).toBe(2);
    expect(xml).toContain("<ItemRef><FullName>Job Sheet Line</FullName></ItemRef>");
    expect(xml).toContain("<Quantity>2</Quantity>");
    expect(xml).toContain("<Rate>5000.00</Rate>");
    expect(xml).toContain("<Rate>750.50</Rate>");
  });

  it("appends a VAT line when a vatLine is supplied", () => {
    const xml = buildEstimateAdd(V, "2", {
      customerName: "Acme",
      itemName: "Job Sheet Line",
      lines: [{ description: "Work", qty: 1, unitCost: 1000 }],
      vatLine: { itemName: "VAT @ 15%", amount: 150 },
    });
    expect((xml.match(/<EstimateLineAdd>/g) ?? []).length).toBe(2);
    expect(xml).toContain("<ItemRef><FullName>VAT @ 15%</FullName></ItemRef>");
    expect(xml).toContain("<Rate>150.00</Rate>");
  });

  it("omits the Memo element entirely when no memo is given", () => {
    const xml = buildEstimateAdd(V, "2", {
      customerName: "Acme",
      itemName: "Job Sheet Line",
      lines: [{ description: "Work", qty: 1, unitCost: 1000 }],
    });
    expect(xml).not.toContain("<Memo>");
  });

  it("appends a negative-rate discount line before the VAT line when a discountLine is supplied", () => {
    const xml = buildEstimateAdd(V, "2", {
      customerName: "Sibanye Stillwater",
      itemName: "Job Sheet Line",
      lines: [{ description: "Catering", qty: 1, unitCost: 10000 }],
      discountLine: { itemName: "Sibanye Discount", amount: 250 },
      vatLine: { itemName: "VAT @ 15%", amount: 1462.5 },
    });
    expect((xml.match(/<EstimateLineAdd>/g) ?? []).length).toBe(3);
    expect(xml).toContain("<ItemRef><FullName>Sibanye Discount</FullName></ItemRef>");
    expect(xml).toContain("<Rate>-250.00</Rate>");
    // discount line must precede the VAT line so VAT reads as computed on the discounted amount
    expect(xml.indexOf("Sibanye Discount")).toBeLessThan(xml.indexOf("VAT @ 15%"));
  });
});

describe("buildInvoiceAdd", () => {
  it("includes a LinkToTxnID (QBD's real schema element) when an estimate TxnID is provided", () => {
    const xml = buildInvoiceAdd(V, "3", {
      customerName: "Acme",
      itemName: "Job Sheet Line",
      lines: [{ description: "Work", qty: 1, unitCost: 1000 }],
      estimateTxnId: "80000012-1699999999",
    });
    expect(xml).toContain("<LinkToTxnID>80000012-1699999999</LinkToTxnID>");
    expect(xml).toContain("<InvoiceAddRq requestID=\"3\">");
  });

  it("omits LinkToTxnID when no estimate is linked", () => {
    const xml = buildInvoiceAdd(V, "3", {
      customerName: "Acme",
      itemName: "Job Sheet Line",
      lines: [{ description: "Work", qty: 1, unitCost: 1000 }],
    });
    expect(xml).not.toContain("LinkToTxnID");
  });
});

describe("buildItemServiceAdd", () => {
  it("references the configured income account", () => {
    const xml = buildItemServiceAdd(V, "0", "Job Sheet Line", "Sales");
    expect(xml).toContain("<Name>Job Sheet Line</Name>");
    expect(xml).toContain("<AccountRef><FullName>Sales</FullName></AccountRef>");
  });
});

describe("buildBillAdd", () => {
  it("emits a vendor ref, expense account and amount", () => {
    const xml = buildBillAdd(V, "4", {
      vendorName: "Local Caterer",
      amount: 1234.5,
      expenseAccount: "Job Expenses",
      memo: "Soup order",
    });
    expect(xml).toContain("<VendorRef><FullName>Local Caterer</FullName></VendorRef>");
    expect(xml).toContain("<AccountRef><FullName>Job Expenses</FullName></AccountRef>");
    expect(xml).toContain("<Amount>1234.50</Amount>");
    expect(xml).toContain("<Memo>Soup order</Memo>");
  });

  it("adds a CustomerRef on the expense line when job-costed against a Customer:Job", () => {
    const xml = buildBillAdd(V, "4", {
      vendorName: "Local Caterer",
      amount: 1234.5,
      expenseAccount: "Job Expenses",
      customerJobRef: "Harmony:Solar Torch Delivery",
    });
    expect(xml).toContain("<CustomerRef><FullName>Harmony:Solar Torch Delivery</FullName></CustomerRef>");
    // Must sit inside ExpenseLineAdd, not BillAdd itself — QBD tracks job-costing per line.
    expect(xml.indexOf("<ExpenseLineAdd>")).toBeLessThan(xml.indexOf("<CustomerRef>"));
  });

  it("omits CustomerRef when not job-costed", () => {
    const xml = buildBillAdd(V, "4", {
      vendorName: "Local Caterer",
      amount: 1234.5,
      expenseAccount: "Job Expenses",
    });
    expect(xml).not.toContain("CustomerRef");
  });
});
