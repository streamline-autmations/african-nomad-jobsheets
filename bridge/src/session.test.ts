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

function estimateRow(jobSheetId: string, name: string, createdAt: string): QueueRow {
  return {
    id: `e-${jobSheetId}`,
    job_sheet_id: jobSheetId,
    action: "create_estimate",
    payload: {
      customer_name_raw: name,
      job_description: "Catering — site visit",
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
