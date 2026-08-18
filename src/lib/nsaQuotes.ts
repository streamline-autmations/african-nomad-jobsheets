import { supabase, supabaseConfigured } from "./supabase";
import { calculateLinesSubtotal, round2, VAT_RATE } from "./feeCalculations";
import type { LineItem } from "../types";
import type { NsaQuote, NsaQuoteStatus } from "../nsaTypes";

// Every Supabase call for the NSA Quote System goes through this file —
// components never import `supabase` directly. Deliberately separate from
// jobSheets.ts: this hits its own table (nsa_quotes), not job_sheets.

function requireSupabase() {
  if (!supabase || !supabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }
  return supabase;
}

export interface NsaQuoteTotals {
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  total: number;
}

/**
 * The client-facing subtotal/discount/VAT/total on NSA's own document.
 *
 * NSA quotes still carry none of AN's *fee cascade* — the NSA and Tuscany 10%
 * cuts are internal profit splits and must never appear on something a mine
 * sees. A discount is different: it reduces what the client is actually
 * billed, so it has to be on the document the client receives, or they never
 * get it. (Sibanye's 2.5% for 30-day terms is the live case; see
 * 202608090002_nsa_quote_discount.sql.)
 *
 * Applied to the subtotal BEFORE VAT, so VAT is charged on the discounted
 * amount — identical to calculateJobSheetFinancials, which is what keeps the
 * internal job sheet and the client's quote agreeing to the cent.
 */
export function calculateNsaQuoteTotals(
  lines: LineItem[],
  discountAmount = 0,
): NsaQuoteTotals {
  const subtotal = calculateLinesSubtotal(lines);
  const discount = round2(Math.max(0, discountAmount));
  const discountedSubtotal = round2(subtotal - discount);
  const vatAmount = round2(discountedSubtotal * VAT_RATE);
  const total = round2(discountedSubtotal + vatAmount);
  return { subtotal, discountAmount: discount, vatAmount, total };
}

type NsaQuoteRow = {
  id: string;
  quote_number: string;
  vendor_number: string;
  po_number: string;
  client_name: string;
  client_address: string;
  job_description: string;
  event_date: string | null;
  status: NsaQuoteStatus;
  lines: LineItem[];
  subtotal: number;
  discount_amount: number;
  vat_amount: number;
  total: number;
  nsa_invoice_number: string | null;
  an_job_sheet_id: string | null;
  created_at: string;
  sent_at: string | null;
  accepted_at: string | null;
  invoiced_at: string | null;
};

function toNsaQuote(row: NsaQuoteRow): NsaQuote {
  return {
    id: row.id,
    quoteNumber: row.quote_number,
    vendorNumber: row.vendor_number,
    poNumber: row.po_number,
    clientName: row.client_name,
    clientAddress: row.client_address,
    jobDescription: row.job_description,
    eventDate: row.event_date,
    status: row.status,
    lines: row.lines ?? [],
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discount_amount ?? 0),
    vatAmount: Number(row.vat_amount),
    total: Number(row.total),
    nsaInvoiceNumber: row.nsa_invoice_number,
    anJobSheetId: row.an_job_sheet_id,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    invoicedAt: row.invoiced_at,
  };
}

export async function fetchNsaQuotes(): Promise<NsaQuote[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("nsa_quotes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toNsaQuote);
}

/**
 * The most recent quote/invoice raised for a client, or null if this is the
 * first. Used to prefill the vendor number and address when converting a job
 * sheet into an NSA quote: both are properties of the NSA-to-mine relationship
 * rather than of the individual job, so they're stable across quotes to the
 * same mine and shouldn't be retyped every time.
 *
 * Matched on exact client name — the same string the job sheet carries in
 * customer_name_raw, since that's what gets copied onto the quote.
 */
export async function fetchLatestNsaQuoteForClient(
  clientName: string,
): Promise<NsaQuote | null> {
  const trimmed = clientName.trim();
  if (!trimmed) return null;

  const client = requireSupabase();
  const { data, error } = await client
    .from("nsa_quotes")
    .select("*")
    .eq("client_name", trimmed)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toNsaQuote(data) : null;
}

export interface SaveNsaQuoteDraftInput {
  id?: string;
  quoteNumber: string;
  vendorNumber: string;
  poNumber: string;
  clientName: string;
  clientAddress: string;
  jobDescription: string;
  eventDate: string | null;
  lines: LineItem[];
  /**
   * A real reduction to what this client is billed, applied before VAT.
   * Optional because most quotes have none; set by the job-sheet hand-off,
   * which carries across whatever discount the AN fee cascade worked out.
   */
  discountAmount?: number;
}

export async function saveNsaQuoteDraft(input: SaveNsaQuoteDraftInput): Promise<NsaQuote> {
  const client = requireSupabase();
  const totals = calculateNsaQuoteTotals(input.lines, input.discountAmount ?? 0);

  const row = {
    quote_number: input.quoteNumber,
    vendor_number: input.vendorNumber,
    po_number: input.poNumber,
    client_name: input.clientName,
    client_address: input.clientAddress,
    job_description: input.jobDescription,
    event_date: input.eventDate,
    lines: input.lines,
    subtotal: totals.subtotal,
    discount_amount: totals.discountAmount,
    vat_amount: totals.vatAmount,
    total: totals.total,
  };

  const query = input.id
    ? client.from("nsa_quotes").update(row).eq("id", input.id).eq("status", "draft")
    : client.from("nsa_quotes").insert(row);

  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return toNsaQuote(data);
}

// Direct invoice creation — not every invoice starts life as a formal quote
// (e.g. a small ad-hoc order like the reference "Beanies" invoice). This
// skips straight to status 'invoiced' instead of draft/sent/accepted.
export interface CreateNsaInvoiceDirectInput {
  nsaInvoiceNumber: string;
  vendorNumber: string;
  poNumber: string;
  clientName: string;
  clientAddress: string;
  jobDescription: string;
  eventDate: string | null;
  lines: LineItem[];
  /**
   * A real reduction to what this client is billed, applied before VAT.
   * Optional because most quotes have none; set by the job-sheet hand-off,
   * which carries across whatever discount the AN fee cascade worked out.
   */
  discountAmount?: number;
}

export async function createNsaInvoiceDirect(
  input: CreateNsaInvoiceDirectInput,
): Promise<NsaQuote> {
  const client = requireSupabase();
  const totals = calculateNsaQuoteTotals(input.lines, input.discountAmount ?? 0);

  const row = {
    // No formal quote number exists for a direct invoice — reuse the
    // invoice number so quote_number (not-null) still has a sensible value.
    quote_number: input.nsaInvoiceNumber,
    vendor_number: input.vendorNumber,
    po_number: input.poNumber,
    client_name: input.clientName,
    client_address: input.clientAddress,
    job_description: input.jobDescription,
    event_date: input.eventDate,
    lines: input.lines,
    subtotal: totals.subtotal,
    discount_amount: totals.discountAmount,
    vat_amount: totals.vatAmount,
    total: totals.total,
    status: "invoiced" as const,
    nsa_invoice_number: input.nsaInvoiceNumber,
    invoiced_at: new Date().toISOString(),
  };

  const { data, error } = await client.from("nsa_quotes").insert(row).select("*").single();
  if (error) throw error;
  return toNsaQuote(data);
}

// Status is a human-marked trail (mine accepted it, invoice was raised) —
// there's no automatic detection, matching the same approval-gate philosophy
// as the AN Job Sheet App: a human explicitly records what happened.
export async function markNsaQuoteSent(id: string): Promise<NsaQuote> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("nsa_quotes")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select("*")
    .single();
  if (error) throw error;
  return toNsaQuote(data);
}

export async function markNsaQuoteAccepted(id: string): Promise<NsaQuote> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("nsa_quotes")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "sent")
    .select("*")
    .single();
  if (error) throw error;
  return toNsaQuote(data);
}

export async function markNsaQuoteInvoiced(
  id: string,
  nsaInvoiceNumber: string,
): Promise<NsaQuote> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("nsa_quotes")
    .update({
      status: "invoiced",
      invoiced_at: new Date().toISOString(),
      nsa_invoice_number: nsaInvoiceNumber,
    })
    .eq("id", id)
    .eq("status", "accepted")
    .select("*")
    .single();
  if (error) throw error;
  return toNsaQuote(data);
}

// Records that an accepted NSA quote was converted into a real AN Job Sheet
// (Component 1) — the actual job_sheets insert happens in
// convertNsaQuoteToJobSheet (src/lib/nsaToJobSheet.ts), which calls this
// afterwards so the "Create AN Job Sheet" button can't fire twice for the
// same quote.
export async function markNsaQuoteConvertedToJobSheet(
  id: string,
  jobSheetId: string,
): Promise<NsaQuote> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("nsa_quotes")
    .update({ an_job_sheet_id: jobSheetId })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return toNsaQuote(data);
}
