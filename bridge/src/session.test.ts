import { describe, expect, it } from "vitest";
import { SessionManager } from "./session";
import { loadConfig } from "./config";
import type { QueueRow } from "./types";
import { FakeQueueStore, makeQbdResponder, runQbwcSession } from "./testFakes";

const config = loadConfig({
  QBWC_USERNAME: "an-jobsheets",
  QBWC_PASSWORD: "secret",
  SUPABASE_URL: "x",
  SUPABASE_SERVICE_ROLE_KEY: "x",
});

function customerRow(jobSheetId: string, name: string, createdAt: string): QueueRow {
  return {
    id: `c-${jobSheetId}`,
    job_sheet_id: jobSheetId,
    action: "create_customer",
    payload: { name },
    status: "pending",
    qbd_txn_id: null,
    error_message: null,
    created_at: createdAt,
    synced_at: null,
  };
}

// jobDescription defaults to "" so tests about customer-ensure/duplicate
// mechanics aren't also implicitly exercising the Customer:Job path — that
// gets its own dedicated tests below.
function estimateRow(
  jobSheetId: string,
  name: string,
  createdAt: string,
  jobDescription = "",
): QueueRow {
  return {
    id: `e-${jobSheetId}`,
    job_sheet_id: jobSheetId,
    action: "create_estimate",
    payload: {
      customer_name_raw: name,
      job_description: jobDescription,
      client_lines: [{ id: "l1", description: "Catering", qty: 1, unitCost: 10000, lineTotal: 10000 }],
      client_subtotal: 10000,
      vat_amount: 1500,
      client_total: 11500,
    },
    status: "pending",
    qbd_txn_id: null,
    error_message: null,
    created_at: createdAt,
    synced_at: null,
  };
}

function billRow(
  jobSheetId: string,
  createdAt: string,
  overrides: Partial<QueueRow["payload"]> = {},
): QueueRow {
  return {
    id: `b-${jobSheetId}-${createdAt}`,
    job_sheet_id: jobSheetId,
    action: "create_bill",
    payload: {
      supplier_name: "Local Caterer",
      amount: 4000,
      memo: "Food cost",
      ...overrides,
    },
    status: "pending",
    qbd_txn_id: null,
    error_message: null,
    created_at: createdAt,
    synced_at: null,
  };
}

describe("authenticate", () => {
  it("rejects bad credentials with 'nvu' and no session", async () => {
    const store = new FakeQueueStore([]);
    const manager = new SessionManager(store, config);
    const [, indicator] = await manager.authenticate("wrong", "creds");
    expect(indicator).toBe("nvu");
  });

  it("returns 'none' when there is no pending work", async () => {
    const store = new FakeQueueStore([]);
    const manager = new SessionManager(store, config);
    const [, indicator] = await manager.authenticate("an-jobsheets", "secret");
    expect(indicator).toBe("none");
  });

  it("recovers rows stranded in 'sent' before planning", async () => {
    const stranded = estimateRow("js1", "Acme", "2026-07-16T00:00:00Z");
    stranded.status = "sent";
    const store = new FakeQueueStore([stranded]);
    const manager = new SessionManager(store, config);
    await manager.authenticate("an-jobsheets", "secret");
    expect(store.requeuedStale).toBe(1);
  });
});

describe("full session — new customer + estimate (matches approve_job_sheet output)", () => {
  it("ensures items, adds the customer, creates the estimate, and records everything", async () => {
    const store = new FakeQueueStore([
      customerRow("js1", "Sibanye Stillwater", "2026-07-16T00:00:00Z"),
      estimateRow("js1", "Sibanye Stillwater", "2026-07-16T00:00:01Z"),
    ]);
    const manager = new SessionManager(store, config);
    const responder = makeQbdResponder(); // items missing, customer new

    const result = await runQbwcSession(manager, "an-jobsheets", "secret", responder);

    expect(result.indicator).toBe("");

    // Item ensure (query -> add) for VAT and service item, then customer, then estimate.
    const kinds = result.requests.map((r) =>
      /<(\w+Rq) requestID=/.exec(r)?.[1],
    );
    expect(kinds).toEqual([
      "ItemQueryRq", // VAT @ 15% — not found
      "ItemServiceAddRq", // create VAT item
      "ItemQueryRq", // Job Sheet Line — not found
      "ItemServiceAddRq", // create service item
      "CustomerAddRq", // Sibanye Stillwater
      "EstimateAddRq",
    ]);

    // Both queue rows confirmed with QBD ids.
    expect(store.rows.every((r) => r.status === "confirmed")).toBe(true);
    expect(store.rows.find((r) => r.action === "create_estimate")!.qbd_txn_id).toMatch(/^9/);
    expect(store.rows.find((r) => r.action === "create_customer")!.qbd_txn_id).toMatch(/^8/);

    // Job sheet reached 'synced' with an estimate TxnID, and customer mirrored.
    const js = store.jobSheets.get("js1")!;
    expect(js.status).toBe("synced");
    expect(js.estimateTxnId).toBeTruthy();
    expect(js.customerId).toBeTruthy();
    expect(store.customers).toHaveLength(1);

    expect(result.close).toContain("synced");
  });
});

describe("full session — duplicate customer repair", () => {
  it("falls back to CustomerQuery to recover the existing ListID", async () => {
    const store = new FakeQueueStore([
      customerRow("js2", "Existing Client", "2026-07-16T00:00:00Z"),
      estimateRow("js2", "Existing Client", "2026-07-16T00:00:01Z"),
    ]);
    const manager = new SessionManager(store, config);
    const responder = makeQbdResponder({
      existingItems: new Set(["VAT @ 15%", "Job Sheet Line"]),
      duplicateCustomers: new Set(["Existing Client"]),
    });

    const result = await runQbwcSession(manager, "an-jobsheets", "secret", responder);

    const kinds = result.requests.map((r) => /<(\w+Rq) requestID=/.exec(r)?.[1]);
    expect(kinds).toEqual([
      "ItemQueryRq", // VAT exists
      "ItemQueryRq", // service item exists
      "CustomerAddRq", // returns 3100 duplicate
      "CustomerQueryRq", // repair: look up existing ListID
      "EstimateAddRq",
    ]);

    expect(store.rows.every((r) => r.status === "confirmed")).toBe(true);
    expect(store.jobSheets.get("js2")!.status).toBe("synced");
    expect(store.customers).toHaveLength(1);
  });
});

describe("full session — existing customer, no create_customer row", () => {
  it("ensures the customer exists in QBD (not just Supabase) before creating the estimate", async () => {
    // Regression test: a customer row can have customer_id set (no
    // create_customer queued) while never having actually been synced to
    // QBD — e.g. seeded directly into Supabase. Without the ensure_customer
    // step, EstimateAdd used to fail with "invalid reference to QuickBooks
    // Customer" because QBD had no record of it at all.
    const store = new FakeQueueStore([
      estimateRow("js3", "Known Customer", "2026-07-16T00:00:00Z"),
    ]);
    const manager = new SessionManager(store, config);
    const responder = makeQbdResponder({
      existingItems: new Set(["VAT @ 15%", "Job Sheet Line"]),
      existingCustomers: new Set(), // not found in QBD -> must be auto-created
    });

    const result = await runQbwcSession(manager, "an-jobsheets", "secret", responder);
    const kinds = result.requests.map((r) => /<(\w+Rq) requestID=/.exec(r)?.[1]);
    expect(kinds).toEqual([
      "CustomerQueryRq", // Known Customer — not found
      "CustomerAddRq", // auto-created
      "ItemQueryRq",
      "ItemQueryRq",
      "EstimateAddRq",
    ]);
    expect(store.jobSheets.get("js3")!.status).toBe("synced");
    expect(store.customers).toHaveLength(1);
  });

  it("skips creating the customer when the query already finds it in QBD", async () => {
    const store = new FakeQueueStore([
      estimateRow("js3b", "Already Synced Customer", "2026-07-16T00:00:00Z"),
    ]);
    const manager = new SessionManager(store, config);
    const responder = makeQbdResponder({
      existingItems: new Set(["VAT @ 15%", "Job Sheet Line"]),
      existingCustomers: new Set(["Already Synced Customer"]),
    });

    const result = await runQbwcSession(manager, "an-jobsheets", "secret", responder);
    const kinds = result.requests.map((r) => /<(\w+Rq) requestID=/.exec(r)?.[1]);
    expect(kinds).toEqual(["CustomerQueryRq", "ItemQueryRq", "ItemQueryRq", "EstimateAddRq"]);
    expect(store.jobSheets.get("js3b")!.status).toBe("synced");
  });
});

describe("full session — job costing (Customer:Job + expense Bills)", () => {
  it("creates the Job under the customer and books the Estimate against Customer:Job", async () => {
    const store = new FakeQueueStore([
      estimateRow("js5", "Harmony", "2026-07-20T00:00:00Z", "Solar Torch Delivery"),
    ]);
    const manager = new SessionManager(store, config);
    const responder = makeQbdResponder({
      existingItems: new Set(["VAT @ 15%", "Job Sheet Line"]),
      existingCustomers: new Set(["Harmony"]), // parent already synced, job is new
    });

    const result = await runQbwcSession(manager, "an-jobsheets", "secret", responder);
    const kinds = result.requests.map((r) => /<(\w+Rq) requestID=/.exec(r)?.[1]);
    expect(kinds).toEqual([
      "CustomerQueryRq", // parent "Harmony" — found
      "CustomerQueryRq", // "Harmony:Solar Torch Delivery" — not found
      "CustomerAddRq", // job created under ParentRef
      "ItemQueryRq",
      "ItemQueryRq",
      "EstimateAddRq",
    ]);

    const jobAdd = result.requests.find((r) => r.includes("<CustomerAddRq"))!;
    expect(jobAdd).toContain("<Name>Solar Torch Delivery</Name>");
    expect(jobAdd).toContain("<ParentRef><FullName>Harmony</FullName></ParentRef>");

    const estimateAdd = result.requests.find((r) => r.includes("<EstimateAddRq"))!;
    expect(estimateAdd).toContain(
      "<CustomerRef><FullName>Harmony:Solar Torch Delivery</FullName></CustomerRef>",
    );
    expect(store.jobSheets.get("js5")!.status).toBe("synced");
  });

  it("creates the job under a BRAND NEW customer in the same batch, in the right order", async () => {
    // Regression test: this is the mainline path for any job sheet converted
    // from an NSA Quote (customer_id always starts null there) — a new
    // customer AND a job in the same approve_job_sheet() batch. The job's
    // existence-check used to run in the prelude, before the customer even
    // existed yet, so QBD rejected the Estimate with "invalid reference to
    // QuickBooks Customer". The job-ensure must run after customer_add.
    const store = new FakeQueueStore([
      customerRow("js9", "Harmony", "2026-07-21T00:00:00Z"),
      estimateRow("js9", "Harmony", "2026-07-21T00:00:01Z", "IDK"),
      billRow("js9", "2026-07-21T00:00:01Z", {
        supplier_name: "PowerTech Wholesalers",
        amount: 80000,
        job_customer_name: "Harmony",
        job_name: "IDK",
      }),
    ]);
    const manager = new SessionManager(store, config);
    const responder = makeQbdResponder({
      existingItems: new Set(["VAT @ 15%", "Job Sheet Line"]),
      existingVendors: new Set(),
      existingCustomers: new Set(), // job not found by query -> must be created
    });

    const result = await runQbwcSession(manager, "an-jobsheets", "secret", responder);
    const kinds = result.requests.map((r) => /<(\w+Rq) requestID=/.exec(r)?.[1]);

    // CustomerAdd for the parent must come before the job's CustomerQuery —
    // the reverse order is exactly the bug this test guards against.
    expect(kinds.indexOf("CustomerAddRq")).toBeLessThan(kinds.lastIndexOf("CustomerQueryRq"));
    // Vendor/item ensures are unordered prelude steps (independent of
    // customer/job existence) so they run first; what matters is Harmony's
    // CustomerAddRq precedes the job's CustomerQueryRq, asserted above.
    expect(kinds).toEqual([
      "VendorQueryRq",
      "VendorAddRq",
      "ItemQueryRq",
      "ItemQueryRq",
      "CustomerAddRq", // Harmony (new customer)
      "CustomerQueryRq", // Harmony:IDK — not found (parent now exists)
      "CustomerAddRq", // job created under ParentRef
      "EstimateAddRq",
      "BillAddRq",
    ]);

    const estimateAdd = result.requests.find((r) => r.includes("<EstimateAddRq"))!;
    expect(estimateAdd).toContain("<CustomerRef><FullName>Harmony:IDK</FullName></CustomerRef>");
    const billAdd = result.requests.find((r) => r.includes("<BillAddRq"))!;
    expect(billAdd).toContain(
      "<CustomerRef><FullName>Harmony:IDK</FullName></CustomerRef>",
    );

    expect(store.rows.every((r) => r.status === "confirmed")).toBe(true);
    expect(store.jobSheets.get("js9")!.status).toBe("synced");
  });

  it("still works when the customer row sorts AFTER its dependents (Postgres ties all rows in one approve_job_sheet() call at the same created_at, so fetch order isn't guaranteed)", async () => {
    // Real-world failure this reproduces: two Bills failed while the
    // Estimate and a third Bill succeeded, all for the same brand-new
    // customer+job, purely because the customer_add row happened to sort
    // after some of its dependents. Giving the customer row a LATER
    // timestamp here forces exactly that ordering.
    const store = new FakeQueueStore([
      estimateRow("js10", "Rowland", "2026-07-21T00:00:00Z", "Cup a Soup project"),
      billRow("js10", "2026-07-21T00:00:00Z", {
        supplier_name: "ABC Printing",
        amount: 13000,
        job_customer_name: "Rowland",
        job_name: "Cup a Soup project",
      }),
      customerRow("js10", "Rowland", "2026-07-21T00:00:01Z"), // sorts LAST
      billRow("js10", "2026-07-21T00:00:01Z", {
        supplier_name: "Speedy Deliveries",
        amount: 500,
        job_customer_name: "Rowland",
        job_name: "Cup a Soup project",
      }),
    ]);
    const manager = new SessionManager(store, config);
    const responder = makeQbdResponder({
      existingItems: new Set(["VAT @ 15%", "Job Sheet Line"]),
      existingVendors: new Set(),
      existingCustomers: new Set(),
    });

    const result = await runQbwcSession(manager, "an-jobsheets", "secret", responder);
    const kinds = result.requests.map((r) => /<(\w+Rq) requestID=/.exec(r)?.[1]);

    const customerAddForRowland = kinds.indexOf("CustomerAddRq");
    const firstTransaction = Math.min(
      kinds.indexOf("EstimateAddRq"),
      kinds.indexOf("BillAddRq"),
    );
    expect(customerAddForRowland).toBeLessThan(firstTransaction);

    expect(store.rows.every((r) => r.status === "confirmed")).toBe(true);
    expect(store.jobSheets.get("js10")!.status).toBe("synced");
  });

  it("books an expense line as a Bill tagged to the same job, ensuring the vendor exists first", async () => {
    const store = new FakeQueueStore([
      estimateRow("js6", "Harmony", "2026-07-20T00:00:00Z", "Solar Torch Delivery"),
      billRow("js6", "2026-07-20T00:00:00Z", {
        supplier_name: "Torch Supplies CC",
        amount: 4000,
        job_customer_name: "Harmony",
        job_name: "Solar Torch Delivery",
      }),
    ]);
    const manager = new SessionManager(store, config);
    const responder = makeQbdResponder({
      existingItems: new Set(["VAT @ 15%", "Job Sheet Line"]),
      existingCustomers: new Set(["Harmony"]),
      existingVendors: new Set(), // vendor not found -> must be auto-created
    });

    const result = await runQbwcSession(manager, "an-jobsheets", "secret", responder);
    const kinds = result.requests.map((r) => /<(\w+Rq) requestID=/.exec(r)?.[1]);
    expect(kinds).toEqual([
      "CustomerQueryRq", // parent "Harmony" — found
      "CustomerQueryRq", // job — not found
      "CustomerAddRq", // job created
      "VendorQueryRq", // "Torch Supplies CC" — not found
      "VendorAddRq", // vendor created
      "ItemQueryRq",
      "ItemQueryRq",
      "EstimateAddRq",
      "BillAddRq",
    ]);

    const billAdd = result.requests.find((r) => r.includes("<BillAddRq"))!;
    expect(billAdd).toContain("<VendorRef><FullName>Torch Supplies CC</FullName></VendorRef>");
    expect(billAdd).toContain(
      "<CustomerRef><FullName>Harmony:Solar Torch Delivery</FullName></CustomerRef>",
    );
    expect(billAdd).toContain("<Amount>4000.00</Amount>");

    const bill = store.rows.find((r) => r.action === "create_bill")!;
    expect(bill.status).toBe("confirmed");
  });

  it("falls back to the configured default vendor when an expense line has no vendor typed", async () => {
    const store = new FakeQueueStore([
      billRow("js7", "2026-07-20T00:00:00Z", { supplier_name: undefined }),
    ]);
    const manager = new SessionManager(store, config);
    const responder = makeQbdResponder({ existingVendors: new Set(["General Supplier"]) });

    const result = await runQbwcSession(manager, "an-jobsheets", "secret", responder);
    const billAdd = result.requests.find((r) => r.includes("<BillAddRq"))!;
    expect(billAdd).toContain("<VendorRef><FullName>General Supplier</FullName></VendorRef>");
    expect(store.rows.find((r) => r.action === "create_bill")!.status).toBe("confirmed");
  });
});

describe("full session — estimate failure marks the row and job sheet failed", () => {
  it("records the QBD error and does not mark the sheet synced", async () => {
    const store = new FakeQueueStore([
      estimateRow("js4", "Known Customer", "2026-07-16T00:00:00Z"),
    ]);
    const manager = new SessionManager(store, config);

    // Responder that fails the EstimateAdd with a realistic QBD error.
    const base = makeQbdResponder({ existingItems: new Set(["VAT @ 15%", "Job Sheet Line"]) });
    const responder = (request: string) => {
      if (request.includes("<EstimateAddRq")) {
        const id = /requestID="([^"]*)"/.exec(request)?.[1] ?? "";
        return `<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>` +
          `<EstimateAddRs requestID="${id}" statusCode="3140" statusSeverity="Error" ` +
          `statusMessage="There is an invalid reference to QuickBooks Customer."></EstimateAddRs>` +
          `</QBXMLMsgsRs></QBXML>`;
      }
      return base(request);
    };

    const result = await runQbwcSession(manager, "an-jobsheets", "secret", responder);

    const estimate = store.rows.find((r) => r.action === "create_estimate")!;
    expect(estimate.status).toBe("failed");
    expect(estimate.error_message).toContain("invalid reference");
    expect(store.jobSheets.get("js4")!.status).toBe("failed");
    expect(result.close).toContain("error");
  });
});

describe("full session — invoice failure never corrupts an already-synced job sheet", () => {
  // Regression test: create_invoice always converts an already-'synced' job
  // sheet (see convert_job_sheet_to_invoice()). A failed InvoiceAdd used to
  // incorrectly flip the whole job sheet to 'failed' — via two different
  // code paths: the normal case handler, and separately the generic
  // failStep() catch-all used for unparseable responses. Covers both.
  // A fresh object per test — FakeQueueStore mutates rows in place, so a
  // single shared row would leak status/error_message between tests.
  function invoiceOnlyRow(): QueueRow {
    return {
      id: "inv-js8",
      job_sheet_id: "js8",
      action: "create_invoice",
      payload: {
        customer_name_raw: "Known Customer",
        client_lines: [{ id: "l1", description: "Work", qty: 1, unitCost: 1000, lineTotal: 1000 }],
        client_subtotal: 1000,
        vat_amount: 150,
        client_total: 1150,
        estimate_txn_id: "80000099-1",
      },
      status: "pending",
      qbd_txn_id: null,
      error_message: null,
      created_at: "2026-07-21T00:00:00Z",
      synced_at: null,
    };
  }

  it("leaves status alone on a normal QBD error response", async () => {
    const store = new FakeQueueStore([invoiceOnlyRow()]);
    store.jobSheets.set("js8", { status: "synced", estimateTxnId: "80000099-1" });
    const manager = new SessionManager(store, config);

    const base = makeQbdResponder({
      existingItems: new Set(["VAT @ 15%", "Job Sheet Line"]),
      existingCustomers: new Set(["Known Customer"]),
    });
    const responder = (request: string) => {
      if (request.includes("<InvoiceAddRq")) {
        const id = /requestID="([^"]*)"/.exec(request)?.[1] ?? "";
        return `<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>` +
          `<InvoiceAddRs requestID="${id}" statusCode="3140" statusSeverity="Error" ` +
          `statusMessage="Something went wrong."></InvoiceAddRs></QBXMLMsgsRs></QBXML>`;
      }
      return base(request);
    };

    await runQbwcSession(manager, "an-jobsheets", "secret", responder);

    expect(store.rows.find((r) => r.action === "create_invoice")!.status).toBe("failed");
    expect(store.jobSheets.get("js8")!.status).toBe("synced");
  });

  it("leaves status alone even on an unparseable QBD response (failStep path)", async () => {
    const store = new FakeQueueStore([invoiceOnlyRow()]);
    store.jobSheets.set("js8", { status: "synced", estimateTxnId: "80000099-1" });
    const manager = new SessionManager(store, config);

    const base = makeQbdResponder({
      existingItems: new Set(["VAT @ 15%", "Job Sheet Line"]),
      existingCustomers: new Set(["Known Customer"]),
    });
    const responder = (request: string) =>
      request.includes("<InvoiceAddRq") ? "not a qbXML document at all" : base(request);

    await runQbwcSession(manager, "an-jobsheets", "secret", responder);

    const invoice = store.rows.find((r) => r.action === "create_invoice")!;
    expect(invoice.status).toBe("failed");
    expect(invoice.error_message).toContain("Unparseable");
    expect(store.jobSheets.get("js8")!.status).toBe("synced");
  });
});
