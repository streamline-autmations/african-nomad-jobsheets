import { describe, expect, it } from "vitest";
import {
  buildCustomerAdd,
  buildEstimateAdd,
  buildInvoiceAdd,
  buildItemServiceAdd,
  buildBillAdd,
} from "./builders";
import { qbdName } from "./xml";

const V = "13.0";

describe("qbdName", () => {
  it("caps names at 41 chars and replaces the QBD list separator", () => {
    expect(qbdName("A".repeat(50)).length).toBe(41);
    expect(qbdName("Parent:Child")).toBe("Parent-Child");
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
});

describe("buildInvoiceAdd", () => {
  it("includes a LinkedTxnID when an estimate TxnID is provided", () => {
    const xml = buildInvoiceAdd(V, "3", {
      customerName: "Acme",
      itemName: "Job Sheet Line",
      lines: [{ description: "Work", qty: 1, unitCost: 1000 }],
      estimateTxnId: "80000012-1699999999",
    });
    expect(xml).toContain("<LinkedTxnID>80000012-1699999999</LinkedTxnID>");
    expect(xml).toContain("<InvoiceAddRq requestID=\"3\">");
  });

  it("omits LinkedTxnID when no estimate is linked", () => {
    const xml = buildInvoiceAdd(V, "3", {
      customerName: "Acme",
      itemName: "Job Sheet Line",
      lines: [{ description: "Work", qty: 1, unitCost: 1000 }],
    });
    expect(xml).not.toContain("<LinkedTxnID>");
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
});
