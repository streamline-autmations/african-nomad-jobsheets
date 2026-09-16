import { supabase, supabaseConfigured } from "./supabase";
import { calculateJobSheetFinancials, round2, withLineTotal } from "./feeCalculations";
import { emptySheetRow, linesToSheetRows, rowIsBlank, sheetRowsToLines, type SheetRow } from "./jobSheetRows";
import type {
  CommonExpense,
  Company,
  Customer,
  JobSheet,
  JobSheetFile,
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
  qbo_customer_id: string | null;
  job_description: string;
  event_date: string | null;
  status: JobSheet["status"];
  client_lines: LineItem[];
  expense_lines: LineItem[];
  client_subtotal: number;
  sibanye_discount: number;
  vat_amount: number;
  client_total: number;
  expense_total: number;
  gross_profit: number;
  profit_margin_pct: number;
  nsa_fee: number;
  tuscany_fee: number;
  total_fees: number;
  net_profit: number;
  net_margin_pct: number;
  qbd_estimate_txn_id: string | null;
  qbd_invoice_txn_id: string | null;
  nsa_quote_id: string | null;
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
    qboCustomerId: row.qbo_customer_id,
    jobDescription: row.job_description,
    eventDate: row.event_date,
    status: row.status,
    clientLines: row.client_lines ?? [],
    expenseLines: row.expense_lines ?? [],
    clientSubtotal: Number(row.client_subtotal),
    // job_sheets.sibanye_discount keeps its original column name but now holds
    // a rebate AN pays, not a discount off the client's invoice — see
    // feeCalculations.SIBANYE_REBATE_RATE. Rows written before 2026-08-19
    // carry the old meaning and are not restated on read.
    sibanyeRebate: Number(row.sibanye_discount),
    vatAmount: Number(row.vat_amount),
    clientTotal: Number(row.client_total),
    expenseTotal: Number(row.expense_total),
    totalCosts: round2(
      Number(row.expense_total) + Number(row.sibanye_discount) + Number(row.total_fees),
    ),
    grossProfit: Number(row.gross_profit),
    profitMarginPct: Number(row.profit_margin_pct),
    nsaFee: Number(row.nsa_fee),
    tuscanyFee: Number(row.tuscany_fee),
    totalFees: Number(row.total_fees),
    netProfit: Number(row.net_profit),
    netMarginPct: Number(row.net_margin_pct),
    qbdEstimateTxnId: row.qbd_estimate_txn_id,
    qbdInvoiceTxnId: row.qbd_invoice_txn_id,
    nsaQuoteId: row.nsa_quote_id,
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

// Every job sheet regardless of status — backs the History view. Draft ones
// still show up here too (fetchDraftJobSheets stays as the Approvals tab's
// narrower "needs action" list).
export async function fetchAllJobSheets(): Promise<JobSheet[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("job_sheets")
    .select("*")
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
  qboCustomerId?: string | null;
  jobDescription: string;
  eventDate: string | null;
  clientLines: LineItem[];
  expenseLines: LineItem[];
}

function financialsToRow(financials: JobSheetFinancials) {
  return {
    client_subtotal: financials.clientSubtotal,
    sibanye_discount: financials.sibanyeRebate,
    vat_amount: financials.vatAmount,
    client_total: financials.clientTotal,
    expense_total: financials.expenseTotal,
    gross_profit: financials.grossProfit,
    profit_margin_pct: financials.profitMarginPct,
    nsa_fee: financials.nsaFee,
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
    qbo_customer_id: input.qboCustomerId ?? null,
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

// Restricted to drafts by RLS (see 202609030002_allow_deleting_drafts.sql) —
// anything approved/queued/synced/failed represents a real document and
// can't be deleted, only a draft can. Cleans up both possible foreign-key
// blockers first: attached files (which the job_sheets row itself doesn't
// cascade-delete) and, in case this sheet was created FROM an accepted NSA
// quote (the reverse hand-off), that quote's back-reference to it.
export async function deleteJobSheetDraft(id: string): Promise<void> {
  const client = requireSupabase();

  await client.from("nsa_quotes").update({ an_job_sheet_id: null }).eq("an_job_sheet_id", id);

  const files = await fetchJobSheetFiles(id);
  for (const file of files) {
    await deleteJobSheetFile(file.id, file.storagePath);
  }

  const { data, error } = await client
    .from("job_sheets")
    .delete()
    .eq("id", id)
    .eq("status", "draft")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Couldn't delete — it may no longer be a draft.");
  }
}

// TEMP TOOL (added 2026-09-07): combines several draft job sheets for the
// same company/customer into one, e.g. several small quotes for one project
// that should ship to QuickBooks as a single estimate. Rebuilds a single row
// grid across all of them (via jobSheetRows' round-trip helpers, the same
// ones the editor grid itself uses) with one blank separator row between each
// source sheet, so the "which supplier costs back which client line" grouping
// never bleeds from one source sheet's lines into the next one's. Deletes the
// source drafts only after the combined sheet is saved. Not wired to a
// permanent nav entry — see the discreet toggle in ApprovalView.
function trimTrailingBlankRows(rows: SheetRow[]): SheetRow[] {
  let end = rows.length;
  while (end > 0 && rowIsBlank(rows[end - 1])) end -= 1;
  return rows.slice(0, end);
}

export async function mergeDraftJobSheets(
  sheets: JobSheet[],
  companyName: string,
  jobDescription: string,
): Promise<JobSheet> {
  if (sheets.length < 2) {
    throw new Error("Pick at least two draft job sheets to combine.");
  }
  if (sheets.some((s) => s.status !== "draft")) {
    throw new Error("Only draft job sheets can be combined.");
  }
  const [first, ...rest] = sheets;
  if (rest.some((s) => s.companyId !== first.companyId)) {
    throw new Error("Can't combine job sheets from different companies.");
  }
  const sameCustomer = (s: JobSheet) =>
    first.customerId ? s.customerId === first.customerId : s.customerNameRaw === first.customerNameRaw;
  if (rest.some((s) => !sameCustomer(s))) {
    throw new Error("Can't combine job sheets for different customers.");
  }

  let mergedRows: SheetRow[] = [];
  for (const sheet of sheets) {
    const rows = trimTrailingBlankRows(linesToSheetRows(sheet.clientLines, sheet.expenseLines));
    if (rows.length === 0) continue;
    if (mergedRows.length > 0) mergedRows.push(emptySheetRow());
    mergedRows = mergedRows.concat(rows);
  }

  const { clientLines, expenseLines } = sheetRowsToLines(mergedRows);

  const saved = await saveJobSheetDraft({
    companyId: first.companyId,
    companyName,
    customerId: first.customerId,
    customerNameRaw: first.customerNameRaw,
    qboCustomerId: first.qboCustomerId,
    jobDescription,
    eventDate: first.eventDate,
    clientLines: clientLines.map(withLineTotal),
    expenseLines: expenseLines.map(withLineTotal),
  });

  for (const sheet of sheets) {
    await deleteJobSheetDraft(sheet.id);
  }

  return saved;
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

// Resets every failed sync-queue row for this job sheet back to pending and
// the sheet back to 'approved', so the next Web Connector cycle retries it —
// without this, retrying required direct SQL access.
export async function retryJobSheet(id: string): Promise<JobSheet> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("retry_job_sheet", {
    p_job_sheet_id: id,
  });
  if (error) throw error;
  return toJobSheet(data as JobSheetRow);
}

// Queues a create_invoice sync action against the job sheet's already-
// confirmed QBD Estimate (linked via LinkedTxnID in the bridge). Only valid
// once the sheet is 'synced' with an estimate txn id and not already invoiced.
export async function convertJobSheetToInvoice(id: string): Promise<JobSheet> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("convert_job_sheet_to_invoice", {
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

// Files attached to a job sheet — generated quote/invoice PDFs, scanned
// supplier invoices, delivery notes, etc. Lives entirely in this app
// (Supabase Storage): QuickBooks Desktop's own Attached Documents feature
// isn't reachable through qbXML/Web Connector at all.
const JOB_SHEET_FILES_BUCKET = "job-sheet-files";

function toJobSheetFile(row: {
  id: string;
  job_sheet_id: string;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
}): JobSheetFile {
  return {
    id: row.id,
    jobSheetId: row.job_sheet_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
  };
}

export async function fetchJobSheetFiles(jobSheetId: string): Promise<JobSheetFile[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("job_sheet_files")
    .select("*")
    .eq("job_sheet_id", jobSheetId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toJobSheetFile);
}

export async function uploadJobSheetFile(
  jobSheetId: string,
  file: File,
): Promise<JobSheetFile> {
  const client = requireSupabase();
  // Prefixed with a random id so two uploads of a same-named file (e.g. two
  // "invoice.pdf" downloads) never collide in storage.
  const storagePath = `${jobSheetId}/${crypto.randomUUID()}-${file.name}`;

  const { error: uploadError } = await client.storage
    .from(JOB_SHEET_FILES_BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined });
  if (uploadError) throw uploadError;

  const { data, error } = await client
    .from("job_sheet_files")
    .insert({
      job_sheet_id: jobSheetId,
      file_name: file.name,
      storage_path: storagePath,
      content_type: file.type || null,
      size_bytes: file.size,
    })
    .select("*")
    .single();
  if (error) throw error;
  return toJobSheetFile(data);
}

// Bucket is private, so downloads go through a short-lived signed URL rather
// than a public one.
export async function getJobSheetFileDownloadUrl(storagePath: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.storage
    .from(JOB_SHEET_FILES_BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

// NSA Quote -> Job Sheet hand-off (src/lib/nsaToJobSheet.ts). Inserts the job
// sheet and links it back to the quote in one atomic Postgres transaction
// (create_job_sheet_from_nsa_quote, 202608180001) — a row lock on the quote
// plus a re-check that it isn't already linked and is accepted/invoiced, so
// two rapid clicks or two open tabs can't create two job sheets for one
// quote, and the "accepted/invoiced only" rule is enforced by the database,
// not just the UI's canCreateJobSheet check.
export interface CreateJobSheetFromNsaQuoteInput {
  quoteId: string;
  companyId: string;
  customerNameRaw: string;
  jobDescription: string;
  eventDate: string | null;
  clientLines: LineItem[];
  financials: JobSheetFinancials;
}

export async function createJobSheetFromNsaQuote(
  input: CreateJobSheetFromNsaQuoteInput,
): Promise<JobSheet> {
  const client = requireSupabase();
  const f = input.financials;
  const { data, error } = await client.rpc("create_job_sheet_from_nsa_quote", {
    p_quote_id: input.quoteId,
    p_company_id: input.companyId,
    p_customer_name_raw: input.customerNameRaw,
    p_job_description: input.jobDescription,
    p_event_date: input.eventDate,
    p_client_lines: input.clientLines,
    p_client_subtotal: f.clientSubtotal,
    p_sibanye_discount: f.sibanyeRebate,
    p_vat_amount: f.vatAmount,
    p_client_total: f.clientTotal,
    p_expense_total: f.expenseTotal,
    p_gross_profit: f.grossProfit,
    p_profit_margin_pct: f.profitMarginPct,
    p_nsa_fee: f.nsaFee,
    p_tuscany_fee: f.tuscanyFee,
    p_total_fees: f.totalFees,
    p_net_profit: f.netProfit,
    p_net_margin_pct: f.netMarginPct,
  });
  if (error) throw error;
  return toJobSheet(data as JobSheetRow);
}

// Photos attached to individual line items — the actual item, not a general
// job-sheet attachment. Lives in the same private bucket as job_sheet_files,
// under its own prefix, keyed by the row's own client-generated id rather
// than the job sheet's id: a brand-new draft has no job sheet id yet (it
// isn't saved until the form's Save button is pressed), but every row always
// has one from the moment it exists on the grid.
const LINE_PHOTO_PREFIX = "line-photos";

export async function uploadLineItemPhoto(rowId: string, file: File): Promise<string> {
  const client = requireSupabase();
  const storagePath = `${LINE_PHOTO_PREFIX}/${rowId}/${crypto.randomUUID()}-${file.name}`;
  const { error } = await client.storage
    .from(JOB_SHEET_FILES_BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined });
  if (error) throw error;
  return storagePath;
}

// Longer-lived than getJobSheetFileDownloadUrl's 60s: a line photo is meant
// to stay visible on-screen (grid thumbnail) and load into a print/PDF
// preview that can sit open for a while, not just trigger one immediate
// download.
export async function getLineItemPhotoUrl(storagePath: string): Promise<string> {
  const client = requireSupabase();
  const { data, error } = await client.storage
    .from(JOB_SHEET_FILES_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteLineItemPhoto(storagePath: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.storage.from(JOB_SHEET_FILES_BUCKET).remove([storagePath]);
  if (error) throw error;
}

export async function deleteJobSheetFile(id: string, storagePath: string): Promise<void> {
  const client = requireSupabase();
  const { error: storageError } = await client.storage
    .from(JOB_SHEET_FILES_BUCKET)
    .remove([storagePath]);
  if (storageError) throw storageError;

  const { error } = await client.from("job_sheet_files").delete().eq("id", id);
  if (error) throw error;
}
