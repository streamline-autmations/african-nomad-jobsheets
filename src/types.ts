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
}

// A line item with its computed total — this is the shape persisted into
// job_sheets.client_lines / job_sheets.expense_lines (jsonb).
export interface LineItem extends LineItemInput {
  lineTotal: number;
}

export interface JobSheetFinancials {
  clientSubtotal: number;
  vatAmount: number;
  clientTotal: number;
  expenseTotal: number;
  grossProfit: number;
  profitMarginPct: number;
  nsaFee: number;
  sibanyeFee: number;
  tuscanyFee: number;
  totalFees: number;
  netProfit: number;
  netMarginPct: number;
  belowMarginTarget: boolean;
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
  createdAt: string;
  approvedAt: string | null;
  syncedAt: string | null;
}
