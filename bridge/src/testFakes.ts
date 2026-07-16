import type { QueueRow, QueueStore } from "./types";

/** In-memory QueueStore for driving full QBWC sessions in tests. */
export class FakeQueueStore implements QueueStore {
  rows: QueueRow[];
  jobSheets = new Map<string, { status: string; estimateTxnId?: string; invoiceTxnId?: string; customerId?: string }>();
  customers: { name: string; qbdListId: string }[] = [];
  requeuedStale = 0;

  constructor(rows: QueueRow[]) {
    this.rows = rows;
    for (const r of rows) {
      if (!this.jobSheets.has(r.job_sheet_id)) {
        this.jobSheets.set(r.job_sheet_id, { status: "approved" });
      }
    }
  }

  private row(id: string): QueueRow {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new Error(`no such row ${id}`);
    return r;
  }

  async fetchPendingRows(): Promise<QueueRow[]> {
    return this.rows
      .filter((r) => r.status === "pending")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async requeueStaleSent(): Promise<void> {
    this.requeuedStale += 1;
    for (const r of this.rows) if (r.status === "sent") r.status = "pending";
  }

  async markSent(ids: string[]): Promise<void> {
    for (const id of ids) this.row(id).status = "sent";
  }

  async markConfirmed(id: string, qbdId: string): Promise<void> {
    const r = this.row(id);
    r.status = "confirmed";
    r.qbd_txn_id = qbdId;
  }

  async markFailed(id: string, message: string): Promise<void> {
    const r = this.row(id);
    r.status = "failed";
    r.error_message = message;
  }

  async jobSheetQueued(jobSheetId: string): Promise<void> {
    const js = this.jobSheets.get(jobSheetId);
    if (js && js.status === "approved") js.status = "queued";
  }

  async jobSheetSynced(jobSheetId: string, estimateTxnId: string): Promise<void> {
    const js = this.jobSheets.get(jobSheetId) ?? { status: "queued" };
    js.status = "synced";
    js.estimateTxnId = estimateTxnId;
    this.jobSheets.set(jobSheetId, js);
  }

  async jobSheetInvoiceSynced(jobSheetId: string, invoiceTxnId: string): Promise<void> {
    const js = this.jobSheets.get(jobSheetId) ?? { status: "synced" };
    js.invoiceTxnId = invoiceTxnId;
    this.jobSheets.set(jobSheetId, js);
  }

  async jobSheetFailed(jobSheetId: string): Promise<void> {
    const js = this.jobSheets.get(jobSheetId) ?? { status: "queued" };
    js.status = "failed";
    this.jobSheets.set(jobSheetId, js);
  }

  async upsertCustomerMirror(name: string, qbdListId: string): Promise<string> {
    const existing = this.customers.find((c) => c.qbdListId === qbdListId);
    if (existing) existing.name = name;
    else this.customers.push({ name, qbdListId });
    return `cust-${qbdListId}`;
  }

  async setJobSheetCustomer(jobSheetId: string, customerId: string): Promise<void> {
    const js = this.jobSheets.get(jobSheetId) ?? { status: "queued" };
    js.customerId = customerId;
    this.jobSheets.set(jobSheetId, js);
  }
}

/**
 * A stand-in for QuickBooks Desktop: given a qbXML request the bridge emits,
 * returns the qbXML response QBD would send back. Behaviour is configurable to
 * exercise the error-repair branches (item missing, customer duplicate).
 */
export function makeQbdResponder(options: {
  existingItems?: Set<string>;
  duplicateCustomers?: Set<string>;
} = {}) {
  const existingItems = options.existingItems ?? new Set<string>();
  const duplicateCustomers = options.duplicateCustomers ?? new Set<string>();
  let listSeq = 80000000;
  let txnSeq = 90000000;

  function reqId(request: string): string {
    return /requestID="([^"]*)"/.exec(request)?.[1] ?? "";
  }
  function fullName(request: string): string {
    return /<FullName>([^<]*)<\/FullName>|<Name>([^<]*)<\/Name>/.exec(request)?.slice(1).find(Boolean) ?? "";
  }
  function wrap(inner: string): string {
    return `<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>${inner}</QBXMLMsgsRs></QBXML>`;
  }

  return function respond(request: string): string {
    const id = reqId(request);

    if (request.includes("<ItemQueryRq")) {
      const name = fullName(request);
      if (existingItems.has(name)) {
        return wrap(
          `<ItemQueryRs requestID="${id}" statusCode="0" statusSeverity="Info" statusMessage="OK">` +
            `<ItemServiceRet><ListID>${++listSeq}-1</ListID><FullName>${name}</FullName></ItemServiceRet>` +
            `</ItemQueryRs>`,
        );
      }
      return wrap(
        `<ItemQueryRs requestID="${id}" statusCode="500" statusSeverity="Info" statusMessage="Not found."></ItemQueryRs>`,
      );
    }

    if (request.includes("<ItemServiceAddRq")) {
      const name = fullName(request);
      existingItems.add(name);
      return wrap(
        `<ItemServiceAddRs requestID="${id}" statusCode="0" statusSeverity="Info" statusMessage="OK">` +
          `<ItemServiceRet><ListID>${++listSeq}-1</ListID><FullName>${name}</FullName></ItemServiceRet>` +
          `</ItemServiceAddRs>`,
      );
    }

    if (request.includes("<CustomerAddRq")) {
      const name = fullName(request);
      if (duplicateCustomers.has(name)) {
        return wrap(
          `<CustomerAddRs requestID="${id}" statusCode="3100" statusSeverity="Error" ` +
            `statusMessage="The name is already in use."></CustomerAddRs>`,
        );
      }
      return wrap(
        `<CustomerAddRs requestID="${id}" statusCode="0" statusSeverity="Info" statusMessage="OK">` +
          `<CustomerRet><ListID>${++listSeq}-1</ListID><Name>${name}</Name></CustomerRet>` +
          `</CustomerAddRs>`,
      );
    }

    if (request.includes("<CustomerQueryRq")) {
      const name = fullName(request);
      return wrap(
        `<CustomerQueryRs requestID="${id}" statusCode="0" statusSeverity="Info" statusMessage="OK">` +
          `<CustomerRet><ListID>${++listSeq}-1</ListID><Name>${name}</Name></CustomerRet>` +
          `</CustomerQueryRs>`,
      );
    }

    if (request.includes("<EstimateAddRq")) {
      return wrap(
        `<EstimateAddRs requestID="${id}" statusCode="0" statusSeverity="Info" statusMessage="OK">` +
          `<EstimateRet><TxnID>${++txnSeq}-1</TxnID></EstimateRet>` +
          `</EstimateAddRs>`,
      );
    }

    if (request.includes("<InvoiceAddRq")) {
      return wrap(
        `<InvoiceAddRs requestID="${id}" statusCode="0" statusSeverity="Info" statusMessage="OK">` +
          `<InvoiceRet><TxnID>${++txnSeq}-1</TxnID></InvoiceRet>` +
          `</InvoiceAddRs>`,
      );
    }

    if (request.includes("<BillAddRq")) {
      return wrap(
        `<BillAddRs requestID="${id}" statusCode="0" statusSeverity="Info" statusMessage="OK">` +
          `<BillRet><TxnID>${++txnSeq}-1</TxnID></BillRet>` +
          `</BillAddRs>`,
      );
    }

    throw new Error(`Responder got an unrecognised request: ${request.slice(0, 120)}`);
  };
}

/** Drives a full QBWC session loop the way Web Connector would. */
export async function runQbwcSession(
  manager: import("./session").SessionManager,
  user: string,
  pass: string,
  respond: (request: string) => string,
): Promise<{ indicator: string; requests: string[]; close: string }> {
  const [ticket, indicator] = await manager.authenticate(user, pass);
  const requests: string[] = [];
  if (indicator !== "") {
    return { indicator, requests, close: manager.closeConnection(ticket) };
  }

  // Safety bound so a logic bug can't spin forever.
  for (let i = 0; i < 1000; i++) {
    const request = manager.sendRequestXML(ticket);
    if (request === "") break;
    requests.push(request);
    const response = respond(request);
    const pct = await manager.receiveResponseXML(ticket, response);
    if (pct >= 100) break;
  }

  return { indicator, requests, close: manager.closeConnection(ticket) };
}
