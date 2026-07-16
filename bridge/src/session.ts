import { randomUUID } from "crypto";
import type { BridgeConfig } from "./config";
import type { PayloadLine, QueueRow, QueueStore } from "./types";
import {
  buildCustomerAdd,
  buildCustomerQuery,
  buildEstimateAdd,
  buildInvoiceAdd,
  buildItemQuery,
  buildItemServiceAdd,
  buildBillAdd,
  type EstimateLineInput,
} from "./qbxml/builders";
import { parseQbdResponse, QBD_STATUS } from "./qbxml/parsers";
import { qbdName } from "./qbxml/xml";

/**
 * One unit of work in a QBWC session. Each step maps to exactly one qbXML
 * request/response round-trip. Steps can spawn follow-up steps during
 * response handling (e.g. a CustomerAdd that hits a duplicate spawns a
 * CustomerQuery to recover the existing ListID).
 */
type Step =
  | { kind: "ensure_item"; itemName: string }
  | { kind: "item_service_add"; itemName: string }
  | { kind: "customer_add"; queueRowId: string; jobSheetId: string; name: string }
  | { kind: "customer_query"; queueRowId: string; jobSheetId: string; name: string }
  | {
      kind: "estimate_add";
      queueRowId: string;
      jobSheetId: string;
      customerName: string;
      memo?: string;
      lines: EstimateLineInput[];
      vatAmount: number;
    }
  | {
      kind: "invoice_add";
      queueRowId: string;
      jobSheetId: string;
      customerName: string;
      memo?: string;
      lines: EstimateLineInput[];
      vatAmount: number;
      estimateTxnId?: string;
    }
  | {
      kind: "bill_add";
      queueRowId: string;
      supplierBillId?: string;
      vendorName: string;
      amount: number;
      memo?: string;
    };

export interface Session {
  ticket: string;
  createdAt: number;
  steps: Step[];
  index: number;
  completed: number;
  /** Queue row ids touched this session, for a human-readable close summary. */
  touchedRowIds: Set<string>;
  errors: string[];
  /** Guards so we only ensure a given service item once per session. */
  ensuredItems: Set<string>;
}

function toEstimateLines(lines: PayloadLine[] | undefined): EstimateLineInput[] {
  return (lines ?? []).map((line) => ({
    description: line.description,
    qty: line.qty,
    unitCost: line.unitCost,
  }));
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor(
    private readonly store: QueueStore,
    private readonly config: BridgeConfig,
  ) {}

  serverVersion(): string {
    return "AN QBD Bridge 0.1.0";
  }

  clientVersion(): string {
    // Empty string = accept whatever Web Connector version connected.
    return "";
  }

  /**
   * Returns [ticket, companyFileIndicator]. "" means "use the company file
   * currently open in QuickBooks"; "none" means there is no work to do, so
   * Web Connector won't even touch the company file this run.
   */
  async authenticate(username: string, password: string): Promise<[string, string]> {
    const ticket = randomUUID();

    if (username !== this.config.qbwcUsername || password !== this.config.qbwcPassword) {
      // "nvu" = invalid user. No session is stored.
      return [ticket, "nvu"];
    }

    // Recover rows stranded in 'sent' by a bridge crash / QB closing mid-session.
    await this.store.requeueStaleSent(15);

    const rows = await this.store.fetchPendingRows();
    const steps = this.planSteps(rows);

    if (steps.length === 0) {
      return [ticket, "none"];
    }

    this.sessions.set(ticket, {
      ticket,
      createdAt: Date.now(),
      steps,
      index: 0,
      completed: 0,
      touchedRowIds: new Set(),
      errors: [],
      ensuredItems: new Set(),
    });

    // Mark every queued row as 'sent' up front so a second concurrent QBWC
    // run (or the local helper double-firing) won't grab the same rows.
    const rowIds = [...new Set(rows.map((r) => r.id))];
    await this.store.markSent(rowIds);
    for (const row of rows) await this.store.jobSheetQueued(row.job_sheet_id);

    return [ticket, ""];
  }

  private planSteps(rows: QueueRow[]): Step[] {
    const steps: Step[] = [];
    let needsServiceItem = false;
    let needsVatItem = false;

    for (const row of rows) {
      switch (row.action) {
        case "create_customer":
          steps.push({
            kind: "customer_add",
            queueRowId: row.id,
            jobSheetId: row.job_sheet_id,
            name: qbdName(row.payload.name ?? row.payload.customer_name_raw ?? ""),
          });
          break;
        case "create_estimate":
          needsServiceItem = true;
          if (this.config.vatMode === "line") needsVatItem = true;
          steps.push({
            kind: "estimate_add",
            queueRowId: row.id,
            jobSheetId: row.job_sheet_id,
            customerName: qbdName(row.payload.customer_name_raw ?? ""),
            memo: row.payload.job_description || undefined,
            lines: toEstimateLines(row.payload.client_lines),
            vatAmount: row.payload.vat_amount ?? 0,
          });
          break;
        case "create_invoice":
          needsServiceItem = true;
          if (this.config.vatMode === "line") needsVatItem = true;
          steps.push({
            kind: "invoice_add",
            queueRowId: row.id,
            jobSheetId: row.job_sheet_id,
            customerName: qbdName(row.payload.customer_name_raw ?? ""),
            memo: row.payload.job_description || undefined,
            lines: toEstimateLines(row.payload.client_lines),
            vatAmount: row.payload.vat_amount ?? 0,
            estimateTxnId: row.payload.estimate_txn_id,
          });
          break;
        case "create_bill":
          steps.push({
            kind: "bill_add",
            queueRowId: row.id,
            supplierBillId: row.payload.supplier_bill_id,
            vendorName: qbdName(row.payload.supplier_name ?? ""),
            amount: row.payload.amount ?? 0,
            memo: row.payload.memo,
          });
          break;
      }
    }

    // Service items must exist before any transaction references them, so
    // ensure-item steps go at the very front of the plan.
    const prelude: Step[] = [];
    if (needsVatItem) {
      prelude.push({ kind: "ensure_item", itemName: this.config.vatItemName });
    }
    if (needsServiceItem) {
      prelude.push({ kind: "ensure_item", itemName: this.config.itemName });
    }

    return [...prelude, ...steps];
  }

  /** Returns the next qbXML request, or "" if the session has no more work. */
  sendRequestXML(ticket: string): string {
    const session = this.sessions.get(ticket);
    if (!session) return "";
    if (session.index >= session.steps.length) return "";

    const step = session.steps[session.index];
    const requestId = String(session.index);
    const v = this.config.qbxmlVersion;

    switch (step.kind) {
      case "ensure_item":
        return buildItemQuery(v, requestId, step.itemName);
      case "item_service_add":
        return buildItemServiceAdd(v, requestId, step.itemName, this.config.incomeAccount);
      case "customer_add":
        return buildCustomerAdd(v, requestId, step.name);
      case "customer_query":
        return buildCustomerQuery(v, requestId, step.name);
      case "estimate_add":
        return buildEstimateAdd(v, requestId, {
          customerName: step.customerName,
          memo: step.memo,
          lines: step.lines,
          itemName: this.config.itemName,
          vatLine:
            this.config.vatMode === "line" && step.vatAmount > 0
              ? { itemName: this.config.vatItemName, amount: step.vatAmount }
              : undefined,
        });
      case "invoice_add":
        return buildInvoiceAdd(v, requestId, {
          customerName: step.customerName,
          memo: step.memo,
          lines: step.lines,
          itemName: this.config.itemName,
          estimateTxnId: step.estimateTxnId,
          vatLine:
            this.config.vatMode === "line" && step.vatAmount > 0
              ? { itemName: this.config.vatItemName, amount: step.vatAmount }
              : undefined,
        });
      case "bill_add":
        return buildBillAdd(v, requestId, {
          vendorName: step.vendorName,
          amount: step.amount,
          memo: step.memo,
          expenseAccount: this.config.expenseAccount,
        });
    }
  }

  /**
   * Handle a qbXML response. Returns an int 0-100: <100 tells Web Connector
   * to call sendRequestXML again; 100 signals the session is complete.
   */
  async receiveResponseXML(ticket: string, responseXml: string): Promise<number> {
    const session = this.sessions.get(ticket);
    if (!session) return 100;

    const step = session.steps[session.index];
    if (!step) return 100;

    let response;
    try {
      response = parseQbdResponse(responseXml);
    } catch (err) {
      session.errors.push(`Could not parse QBD response: ${(err as Error).message}`);
      await this.failStep(step, `Unparseable QBD response: ${(err as Error).message}`);
      return this.advance(session, false);
    }

    const ok = response.statusCode === QBD_STATUS.OK;

    switch (step.kind) {
      case "ensure_item": {
        if (ok) {
          session.ensuredItems.add(step.itemName);
          return this.advance(session, true);
        }
        // Any non-OK on a FullName item query is treated as "not found" ->
        // create it. If it genuinely exists, the subsequent add returns 3100
        // (duplicate), which we also treat as success.
        session.steps.splice(session.index + 1, 0, {
          kind: "item_service_add",
          itemName: step.itemName,
        });
        return this.advance(session, true);
      }

      case "item_service_add": {
        if (ok || response.statusCode === QBD_STATUS.DUPLICATE_NAME) {
          session.ensuredItems.add(step.itemName);
          return this.advance(session, true);
        }
        session.errors.push(`Could not create item "${step.itemName}": ${response.statusMessage}`);
        return this.advance(session, false);
      }

      case "customer_add": {
        if (ok && response.listId) {
          const customerId = await this.store.upsertCustomerMirror(step.name, response.listId);
          await this.store.setJobSheetCustomer(step.jobSheetId, customerId);
          await this.store.markConfirmed(step.queueRowId, response.listId);
          session.touchedRowIds.add(step.queueRowId);
          return this.advance(session, true);
        }
        if (response.statusCode === QBD_STATUS.DUPLICATE_NAME) {
          // Customer already exists in QBD — look up its ListID to mirror it.
          session.steps.splice(session.index + 1, 0, {
            kind: "customer_query",
            queueRowId: step.queueRowId,
            jobSheetId: step.jobSheetId,
            name: step.name,
          });
          return this.advance(session, true);
        }
        await this.store.markFailed(step.queueRowId, response.statusMessage);
        session.errors.push(`CustomerAdd failed for "${step.name}": ${response.statusMessage}`);
        return this.advance(session, false);
      }

      case "customer_query": {
        if (ok && response.listId) {
          const customerId = await this.store.upsertCustomerMirror(step.name, response.listId);
          await this.store.setJobSheetCustomer(step.jobSheetId, customerId);
          await this.store.markConfirmed(step.queueRowId, response.listId);
          session.touchedRowIds.add(step.queueRowId);
          return this.advance(session, true);
        }
        await this.store.markFailed(
          step.queueRowId,
          `Customer "${step.name}" reported duplicate but lookup failed: ${response.statusMessage}`,
        );
        session.errors.push(`CustomerQuery failed for "${step.name}"`);
        return this.advance(session, false);
      }

      case "estimate_add": {
        if (ok && response.txnId) {
          await this.store.markConfirmed(step.queueRowId, response.txnId);
          await this.store.jobSheetSynced(step.jobSheetId, response.txnId);
          session.touchedRowIds.add(step.queueRowId);
          return this.advance(session, true);
        }
        await this.store.markFailed(step.queueRowId, response.statusMessage);
        await this.store.jobSheetFailed(step.jobSheetId);
        session.errors.push(`EstimateAdd failed: ${response.statusMessage}`);
        return this.advance(session, false);
      }

      case "invoice_add": {
        if (ok && response.txnId) {
          await this.store.markConfirmed(step.queueRowId, response.txnId);
          await this.store.jobSheetInvoiceSynced(step.jobSheetId, response.txnId);
          session.touchedRowIds.add(step.queueRowId);
          return this.advance(session, true);
        }
        await this.store.markFailed(step.queueRowId, response.statusMessage);
        await this.store.jobSheetFailed(step.jobSheetId);
        session.errors.push(`InvoiceAdd failed: ${response.statusMessage}`);
        return this.advance(session, false);
      }

      case "bill_add": {
        if (ok && response.txnId) {
          await this.store.markConfirmed(step.queueRowId, response.txnId);
          session.touchedRowIds.add(step.queueRowId);
          return this.advance(session, true);
        }
        await this.store.markFailed(step.queueRowId, response.statusMessage);
        session.errors.push(`BillAdd failed: ${response.statusMessage}`);
        return this.advance(session, false);
      }
    }
  }

  private async failStep(step: Step, message: string): Promise<void> {
    if ("queueRowId" in step && step.queueRowId) {
      await this.store.markFailed(step.queueRowId, message);
    }
    if ("jobSheetId" in step && step.jobSheetId) {
      await this.store.jobSheetFailed(step.jobSheetId);
    }
  }

  private advance(session: Session, countCompleted: boolean): number {
    if (countCompleted) session.completed += 1;
    session.index += 1;

    if (session.index >= session.steps.length) return 100;

    // Clamp to [1, 99] so a rounding artefact never signals "done" early.
    const pct = Math.round((session.completed / session.steps.length) * 100);
    return Math.min(99, Math.max(1, pct));
  }

  connectionError(ticket: string, message: string): string {
    const session = this.sessions.get(ticket);
    if (session) session.errors.push(`Connection error: ${message}`);
    // "done" tells Web Connector to give up (don't retry another company file).
    return "done";
  }

  getLastError(ticket: string): string {
    const session = this.sessions.get(ticket);
    if (!session || session.errors.length === 0) {
      return "No error.";
    }
    return session.errors.join(" | ");
  }

  closeConnection(ticket: string): string {
    const session = this.sessions.get(ticket);
    this.sessions.delete(ticket);
    if (!session) return "Done.";

    const synced = session.touchedRowIds.size;
    if (session.errors.length > 0) {
      return `Completed with ${session.errors.length} error(s). ${synced} item(s) synced.`;
    }
    return `Done. ${synced} item(s) synced to QuickBooks.`;
  }

  /** Test/introspection helper. */
  getSession(ticket: string): Session | undefined {
    return this.sessions.get(ticket);
  }
}
