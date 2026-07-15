import { supabase, supabaseConfigured } from "./supabase";
import { calculateJobSheetFinancials } from "./feeCalculations";
import type {
  CommonExpense,
  Company,
  Customer,
  JobSheet,
  JobSheetFinancials,
  LineItem,
} from "../types";

// Every Supabase call in this app goes through this file — components never
// import `supabase` directly.

function requireSupabase() {
  if (!supabase || !supabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}

type JobSheetRow = {
  id: string;
  company_id: string;
  customer_id: string | null;
  customer_name_raw: string;
  job_description: string;
  event_date: string | null;
  status: JobSheet["status"];
  client_lines: LineItem[];
  expense_lines: LineItem[];
  client_subtotal: number;
  vat_amount: number;
  client_total: number;
  expense_total: number;
  gross_profit: number;
  profit_margin_pct: number;
  nsa_fee: number;
  sibanye_fee: number;
  tuscany_fee: number;
  total_fees: number;
  net_profit: number;
  net_margin_pct: number;
  qbd_estimate_txn_id: string | null;
  qbd_invoice_txn_id: string | null;
  created_at: string;
  approved_at: string | null;
  synced_at: string | null;
};

function toJobSheet(row: JobSheetRow): JobSheet {
  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    customerNameRaw: row.customer_name_raw,
    jobDescription: row.job_description,
    eventDate: row.event_date,
    status: row.status,
    clientLines: row.client_lines ?? [],
    expenseLines: row.expense_lines ?? [],
    clientSubtotal: Number(row.client_subtotal),
    vatAmount: Number(row.vat_amount),
    clientTotal: Number(row.client_total),
    expenseTotal: Number(row.expense_total),
    grossProfit: Number(row.gross_profit),
    profitMarginPct: Number(row.profit_margin_pct),
    nsaFee: Number(row.nsa_fee),
    sibanyeFee: Number(row.sibanye_fee),
    tuscanyFee: Number(row.tuscany_fee),
    totalFees: Number(row.total_fees),
    netProfit: Number(row.net_profit),
    netMarginPct: Number(row.net_margin_pct),
    belowMarginTarget: Number(row.profit_margin_pct) < 20,
    qbdEstimateTxnId: row.qbd_estimate_txn_id,
    qbdInvoiceTxnId: row.qbd_invoice_txn_id,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    syncedAt: row.synced_at,
  };
}

export async function fetchCompanies(): Promise<Company[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("companies")
    .select("id, name")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchCustomers(): Promise<Customer[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("customers")
    .select("id, qbd_list_id, name, last_synced_at")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    qbdListId: row.qbd_list_id,
    name: row.name,
    lastSyncedAt: row.last_synced_at,
  }));
}

export async function fetchCommonExpenses(): Promise<CommonExpense[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("common_expenses")
    .select("id, label")
    .order("label");
  if (error) throw error;
  return data ?? [];
}

export async function fetchDraftJobSheets(): Promise<JobSheet[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("job_sheets")
    .select("*")
    .eq("status", "draft")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toJobSheet);
}

export async function fetchJobSheetById(id: string): Promise<JobSheet> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("job_sheets")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return toJobSheet(data);
}

export interface SaveJobSheetDraftInput {
  id?: string;
  companyId: string;
  companyName: string;
  customerId: string | null;
  customerNameRaw: string;
  jobDescription: string;
  eventDate: string | null;
  clientLines: LineItem[];
  expenseLines: LineItem[];
}

function financialsToRow(financials: JobSheetFinancials) {
  return {
    client_subtotal: financials.clientSubtotal,
    vat_amount: financials.vatAmount,
    client_total: financials.clientTotal,
    expense_total: financials.expenseTotal,
    gross_profit: financials.grossProfit,
    profit_margin_pct: financials.profitMarginPct,
    nsa_fee: financials.nsaFee,
    sibanye_fee: financials.sibanyeFee,
    tuscany_fee: financials.tuscanyFee,
    total_fees: financials.totalFees,
    net_profit: financials.netProfit,
    net_margin_pct: financials.netMarginPct,
  };
}

// Recomputes the fee cascade server-side-of-the-client (i.e. right before the
// write) rather than trusting whatever numbers happen to be sitting in
// component state, so a stale render can never persist wrong fee amounts.
export async function saveJobSheetDraft(
  input: SaveJobSheetDraftInput,
): Promise<JobSheet> {
  const client = requireSupabase();

  // customerNameRaw always holds the customer's display name, whether typed
  // fresh (no match yet) or copied from the matched customers-table row — the
  // Sibanye fee check needs the name regardless of match state.
  const financials = calculateJobSheetFinancials({
    companyName: input.companyName,
    customerName: input.customerNameRaw,
    clientLines: input.clientLines,
    expenseLines: input.expenseLines,
  });

  const row = {
    company_id: input.companyId,
    customer_id: input.customerId,
    customer_name_raw: input.customerNameRaw,
    job_description: input.jobDescription,
    event_date: input.eventDate,
    client_lines: input.clientLines,
    expense_lines: input.expenseLines,
    ...financialsToRow(financials),
  };

  const query = input.id
    ? client.from("job_sheets").update(row).eq("id", input.id).eq("status", "draft")
    : client.from("job_sheets").insert(row);

  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return toJobSheet(data);
}

// The only path that ever writes to qbd_sync_queue: calls the
// approve_job_sheet() Postgres function, which atomically flips the job
// sheet to 'approved' and queues the create_customer (if needed) and
// create_estimate sync actions. Nothing in this file ever inserts into
// qbd_sync_queue directly.
export async function approveJobSheet(id: string): Promise<JobSheet> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("approve_job_sheet", {
    p_job_sheet_id: id,
  });
  if (error) throw error;
  return toJobSheet(data as JobSheetRow);
}

export type SyncQueueStatus = "pending" | "sent" | "confirmed" | "failed";

export interface SyncQueueEntry {
  id: string;
  jobSheetId: string;
  action: string;
  status: SyncQueueStatus;
  qbdTxnId: string | null;
  errorMessage: string | null;
  createdAt: string;
  syncedAt: string | null;
}

export async function fetchSyncQueueForJobSheet(
  jobSheetId: string,
): Promise<SyncQueueEntry[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("qbd_sync_queue")
    .select("*")
    .eq("job_sheet_id", jobSheetId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    jobSheetId: row.job_sheet_id,
    action: row.action,
    status: row.status,
    qbdTxnId: row.qbd_txn_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    syncedAt: row.synced_at,
  }));
}
