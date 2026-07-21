export type QueueAction =
  | "create_customer"
  | "create_estimate"
  | "create_invoice"
  | "create_bill";

export type QueueStatus = "pending" | "sent" | "confirmed" | "failed";

/** Shape of a line item inside job sheet payloads (written by the app / approve_job_sheet). */
export interface PayloadLine {
  id: string;
  description: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
}

export interface QueueRow {
  id: string;
  job_sheet_id: string;
  action: QueueAction;
  payload: {
    // create_customer
    name?: string;
    // create_estimate / create_invoice
    company_id?: string;
    customer_id?: string | null;
    customer_name_raw?: string;
    job_description?: string;
    event_date?: string | null;
    client_lines?: PayloadLine[];
    client_subtotal?: number;
    /** Sibanye Stillwater's 2.5% invoice discount, when it applies. Added as its own line. */
    discount_amount?: number;
    vat_amount?: number;
    client_total?: number;
    estimate_txn_id?: string;
    // create_bill
    supplier_name?: string;
    amount?: number;
    supplier_bill_id?: string;
    memo?: string;
    /** Customer + job description this expense should be job-costed against, when set. */
    job_customer_name?: string;
    job_name?: string;
  };
  status: QueueStatus;
  qbd_txn_id: string | null;
  error_message: string | null;
  created_at: string;
  synced_at: string | null;
}

/**
 * Everything the session machine needs from Supabase, expressed as an
 * interface so tests can run the full QBWC conversation against an
 * in-memory fake instead of the real database.
 */
export interface QueueStore {
  /** Rows waiting to be synced, oldest first (customer rows precede their estimates by creation order). */
  fetchPendingRows(): Promise<QueueRow[]>;
  /** Recover rows stuck in 'sent' (e.g. bridge restarted mid-session) back to 'pending'. */
  requeueStaleSent(olderThanMinutes: number): Promise<void>;
  markSent(ids: string[]): Promise<void>;
  markConfirmed(id: string, qbdId: string): Promise<void>;
  markFailed(id: string, errorMessage: string): Promise<void>;
  jobSheetQueued(jobSheetId: string): Promise<void>;
  jobSheetSynced(jobSheetId: string, estimateTxnId: string): Promise<void>;
  jobSheetInvoiceSynced(jobSheetId: string, invoiceTxnId: string): Promise<void>;
  jobSheetFailed(jobSheetId: string): Promise<void>;
  /** Insert/refresh the QBD customer mirror row; returns the customers.id uuid. */
  upsertCustomerMirror(name: string, qbdListId: string): Promise<string>;
  setJobSheetCustomer(jobSheetId: string, customerId: string): Promise<void>;
}
