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
  buildVendorAdd,
  buildVendorQuery,
  type EstimateLineInput,
} from "./qbxml/builders";
import { parseQbdResponse, QBD_STATUS } from "./qbxml/parsers";
import { qbdJobFullName, qbdName } from "./qbxml/xml";

/**
 * One unit of work in a QBWC session. Each step maps to exactly one qbXML
 * request/response round-trip. Steps can spawn follow-up steps during
 * response handling (e.g. a CustomerAdd that hits a duplicate spawns a
 * CustomerQuery to recover the existing ListID).
 */
type Step =
  | { kind: "ensure_item"; itemName: string }
  | { kind: "item_service_add"; itemName: string }
  | { kind: "ensure_vendor"; vendorName: string }
  | { kind: "vendor_add"; vendorName: string }
  // queryName is what's sent to CustomerQuery (a flat customer name, or a
  // full "Customer:Job" path); addName/parentName are what get used if a
  // CustomerAdd is needed — QBD's Name element must be just the leaf
  // segment, with the parent (if any) given separately via ParentRef.
  | { kind: "ensure_customer"; queryName: string; addName: string; parentName?: string }
  | { kind: "ensure_customer_add"; addName: string; parentName?: string }
  | { kind: "customer_add"; queueRowId: string; jobSheetId: string; name: string }
  | { kind: "customer_query"; queueRowId: string; jobSheetId: string; name: string }
  | {
      kind: "estimate_add";
      queueRowId: string;
      jobSheetId: string;
      /** Pre-sanitised FullName — flat customer, or "Customer:Job". */
      customerName: string;
      memo?: string;
      lines: EstimateLineInput[];
      discountAmount: number;
      vatAmount: number;
    }
  | {
      kind: "invoice_add";
      queueRowId: string;
      jobSheetId: string;
      customerName: string;
      memo?: string;
      lines: EstimateLineInput[];
      discountAmount: number;
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
      /** Pre-sanitised "Customer:Job" FullName, for QBD's own job-costing/Job Profitability reporting. */
      customerJobRef?: string;
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
    let needsDiscountItem = false;

    // Customers already getting an explicit create_customer step this batch
    // don't need a separate existence check — that step (and its
    // duplicate-name repair branch) already guarantees they exist by the
    // time any estimate/invoice/bill referencing them runs.
    const customersBeingCreated = new Set<string>();
    for (const row of rows) {
      if (row.action === "create_customer") {
        customersBeingCreated.add(qbdName(row.payload.name ?? row.payload.customer_name_raw ?? ""));
      }
    }
    // Customers referenced by an estimate/invoice/bill can also arrive with
    // customer_id already set (e.g. picked from a Supabase customers row
    // that was seeded directly, never through the app's "new customer" flow)
    // while having no matching QBD record — approve_job_sheet only queues
    // create_customer when customer_id is null, so that case is otherwise
    // silently missed. Query-then-create for every such name, deduped.
    const customersToEnsure = new Set<string>();
    // Full "Customer:Job" name -> parent customer name, for every job any
    // estimate/invoice/bill in this batch needs to exist first. Always
    // routed through the prelude (never inlined next to the step that needs
    // it) because create_estimate and its sibling create_bill rows share the
    // same transaction timestamp in Postgres, so their relative order in
    // `rows` isn't guaranteed — the job must exist before ANY of them run.
    const jobsToEnsure = new Map<string, { parent: string; job: string }>();
    // Vendors a Bill references must exist in QBD first too — same
    // not-found-by-default gap as customers, since BillAdd's VendorRef
    // doesn't auto-create like an item does.
    const vendorsToEnsure = new Set<string>();

    const noteCustomer = (name: string) => {
      if (name && !customersBeingCreated.has(name)) customersToEnsure.add(name);
    };
    const noteJob = (customerName: string, jobName: string): string => {
      const full = qbdJobFullName(customerName, jobName);
      noteCustomer(customerName);
      jobsToEnsure.set(full, { parent: qbdName(customerName), job: qbdName(jobName) });
      return full;
    };

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
        case "create_invoice": {
          needsServiceItem = true;
          if (this.config.vatMode === "line") needsVatItem = true;
          if ((row.payload.discount_amount ?? 0) > 0) needsDiscountItem = true;

          const baseCustomerName = qbdName(row.payload.customer_name_raw ?? "");
          const jobName = (row.payload.job_description ?? "").trim();
          let customerName: string;
          if (jobName) {
            customerName = noteJob(baseCustomerName, jobName);
          } else {
            noteCustomer(baseCustomerName);
            customerName = baseCustomerName;
          }

          if (row.action === "create_estimate") {
            steps.push({
              kind: "estimate_add",
              queueRowId: row.id,
              jobSheetId: row.job_sheet_id,
              customerName,
              memo: row.payload.job_description || undefined,
              lines: toEstimateLines(row.payload.client_lines),
              discountAmount: row.payload.discount_amount ?? 0,
              vatAmount: row.payload.vat_amount ?? 0,
            });
          } else {
            steps.push({
              kind: "invoice_add",
              queueRowId: row.id,
              jobSheetId: row.job_sheet_id,
              customerName,
              memo: row.payload.job_description || undefined,
              lines: toEstimateLines(row.payload.client_lines),
              discountAmount: row.payload.discount_amount ?? 0,
              vatAmount: row.payload.vat_amount ?? 0,
              estimateTxnId: row.payload.estimate_txn_id,
            });
          }
          break;
        }
        case "create_bill": {
          const jobCustomerName = (row.payload.job_customer_name ?? "").trim();
          const jobName = (row.payload.job_name ?? "").trim();
          const customerJobRef =
            jobCustomerName && jobName ? noteJob(jobCustomerName, jobName) : undefined;
          const vendorName = qbdName(row.payload.supplier_name || this.config.defaultVendorName);
          vendorsToEnsure.add(vendorName);
          steps.push({
            kind: "bill_add",
            queueRowId: row.id,
            supplierBillId: row.payload.supplier_bill_id,
            vendorName,
            amount: row.payload.amount ?? 0,
            memo: row.payload.memo,
            customerJobRef,
          });
          break;
        }
      }
    }

    // Customers and service items must exist before any transaction
    // references them, so ensure-steps go at the very front of the plan.
    // Parent customers first, then jobs (which need their parent to exist).
    const prelude: Step[] = [];
    for (const name of customersToEnsure) {
      prelude.push({ kind: "ensure_customer", queryName: name, addName: name });
    }
    for (const [full, { parent, job }] of jobsToEnsure) {
      prelude.push({ kind: "ensure_customer", queryName: full, addName: job, parentName: parent });
    }
    for (const vendorName of vendorsToEnsure) {
      prelude.push({ kind: "ensure_vendor", vendorName });
    }
    if (needsVatItem) {
      prelude.push({ kind: "ensure_item", itemName: this.config.vatItemName });
    }
    if (needsDiscountItem) {
      prelude.push({ kind: "ensure_item", itemName: this.config.discountItemName });
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
      case "ensure_vendor":
        return buildVendorQuery(v, requestId, step.vendorName);
      case "vendor_add":
        return buildVendorAdd(v, requestId, step.vendorName);
      case "ensure_customer":
        return buildCustomerQuery(v, requestId, step.queryName);
      case "ensure_customer_add":
        return buildCustomerAdd(v, requestId, step.addName, step.parentName);
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
          discountLine:
            step.discountAmount > 0
              ? { itemName: this.config.discountItemName, amount: step.discountAmount }
              : undefined,
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
          discountLine:
            step.discountAmount > 0
              ? { itemName: this.config.discountItemName, amount: step.discountAmount }
              : undefined,
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
          customerJobRef: step.customerJobRef,
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

      case "ensure_vendor": {
        if (ok) return this.advance(session, true);
        // Any non-OK on a FullName vendor query is treated as "not found" ->
        // create it. A genuine race resolves via the 3100 branch below.
        session.steps.splice(session.index + 1, 0, {
          kind: "vendor_add",
          vendorName: step.vendorName,
        });
        return this.advance(session, true);
      }

      case "vendor_add": {
        if (ok || response.statusCode === QBD_STATUS.DUPLICATE_NAME) {
          return this.advance(session, true);
        }
        session.errors.push(`Could not create vendor "${step.vendorName}": ${response.statusMessage}`);
        return this.advance(session, false);
      }

      case "ensure_customer": {
        // Jobs (parentName set) aren't mirrored into the customers table —
        // that table backs the app's customer dropdown, and a job isn't a
        // selectable customer.
        if (ok && response.listId) {
          if (!step.parentName) await this.store.upsertCustomerMirror(step.queryName, response.listId);
          return this.advance(session, true);
        }
        // Not found by exact FullName -> create it. If it genuinely exists
        // (race with another session), the add below returns 3100, also
        // treated as success — the estimate/invoice/bill only needs it to exist.
        session.steps.splice(session.index + 1, 0, {
          kind: "ensure_customer_add",
          addName: step.addName,
          parentName: step.parentName,
        });
        return this.advance(session, true);
      }

      case "ensure_customer_add": {
        const fullName = step.parentName
          ? `${step.parentName}:${step.addName}`
          : step.addName;
        if (ok && response.listId) {
          if (!step.parentName) await this.store.upsertCustomerMirror(fullName, response.listId);
          return this.advance(session, true);
        }
        if (response.statusCode === QBD_STATUS.DUPLICATE_NAME) {
          return this.advance(session, true);
        }
        session.errors.push(
          `Could not ensure customer "${fullName}" exists in QBD: ${response.statusMessage}`,
        );
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
