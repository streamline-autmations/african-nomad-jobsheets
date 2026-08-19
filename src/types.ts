export type CompanyName = "African Nomad" | "Tuscany SA";

export type JobSheetStatus =
  | "draft"
  | "approved"
  | "queued"
  | "synced"
  | "failed";

export interface Company {
  id: string;
  name: CompanyName | string;
}

export interface Customer {
  id: string;
  qbdListId: string | null;
  name: string;
  lastSyncedAt: string | null;
}

export interface CommonExpense {
  id: string;
  label: string;
}

// A line as entered in the UI, before totals are computed.
export interface LineItemInput {
  id: string;
  description: string;
  qty: number;
  unitCost: number;
  /** Supplier this expense is owed to — expense lines only, unused on client lines. */
  vendorName?: string;
  /**
   * Which row of the sheet this line sits on, so the client and supplier
   * columns line up again on reload exactly as they were typed — the Excel
   * job sheet is two lists side by side, and which supplier costs sit under
   * which client line is meaningful (a jacket line is backed by the jacket,
   * its branding and its delivery).
   *
   * Optional because rows written before 2026-08-19 don't have it; those fall
   * back to the old id-pairing. Purely a UI concern — nothing downstream
   * (QBD payloads, the bridge, the QBO path) reads it.
   */
  row?: number;
}

// A line item with its computed total — this is the shape persisted into
// job_sheets.client_lines / job_sheets.expense_lines (jsonb).
export interface LineItem extends LineItemInput {
  lineTotal: number;
}

export interface JobSheetFinancials {
  clientSubtotal: number;
  /**
   * Sibanye Stillwater's 2.5%, as a **cost we carry** — 2.5% of the
   * VAT-inclusive clientTotal. It never reduces what the client is invoiced.
   * Persisted in the job_sheets.sibanye_discount column, which keeps its old
   * name for migration reasons; see feeCalculations.SIBANYE_REBATE_RATE.
   */
  sibanyeRebate: number;
  vatAmount: number;
  clientTotal: number;
  /** Raw supplier-line sum, excluding the rebate and the 10% fee. */
  expenseTotal: number;
  /** The Excel's "Total Expenses:" — expenseTotal + sibanyeRebate + totalFees. */
  totalCosts: number;
  grossProfit: number;
  profitMarginPct: number;
  nsaFee: number;
  tuscanyFee: number;
  totalFees: number;
  netProfit: number;
  netMarginPct: number;
}

export interface JobSheetFile {
  id: string;
  jobSheetId: string;
  fileName: string;
  storagePath: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
}

export interface JobSheet extends JobSheetFinancials {
  id: string;
  companyId: string;
  customerId: string | null;
  customerNameRaw: string;
  jobDescription: string;
  eventDate: string | null;
  status: JobSheetStatus;
  clientLines: LineItem[];
  expenseLines: LineItem[];
  qbdEstimateTxnId: string | null;
  qbdInvoiceTxnId: string | null;
  /**
   * Set once this job sheet has been turned into a client-facing NSA quote.
   * The reciprocal of NsaQuote.anJobSheetId — one records each direction of
   * the hand-off, and both exist because a job can start from either end.
   */
  nsaQuoteId: string | null;
  createdAt: string;
  approvedAt: string | null;
  syncedAt: string | null;
}
