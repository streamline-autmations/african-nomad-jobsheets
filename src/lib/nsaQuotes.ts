import { supabase, supabaseConfigured } from "./supabase";
import { applyVat, calculateLinesSubtotal, round2 } from "./feeCalculations";
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
 * The client-facing subtotal/VAT/total on NSA's own document: subtotal, then
 * VAT on the full subtotal, then total. Nothing is deducted along the way.
 *
 * NSA quotes carry none of AN's fee cascade — the NSA and Tuscany 10% cuts
 * are internal profit splits and must never appear on something a mine sees.
 *
 * Nor is there a discount any more. Corrected 2026-08-19: Sibanye's 2.5% is a
 * cost AN carries for their early payment, not a reduction of what Sibanye is
 * invoiced, so it has no place on the client's document. This reverses
 * 202608090002_nsa_quote_discount.sql. The real NSA paperwork agrees —
 * "Invoice NSA06384" and "Quote 1291" both print a plain
 * subtotal -> "VAT @ 15% on <full subtotal>" -> total with no discount row.
 *
 * discountAmount survives only in the return shape, always 0, because
 * nsa_quotes.discount_amount still exists as a column and historical rows are
 * read through this type. It is not an input: accepting one would let a
 * caller persist a discount that the subtotal/VAT/total beside it do not
 * reflect, which is the same class of disagreement this pair of documents
 * already went wrong on once.
 */
export function calculateNsaQuoteTotals(lines: LineItem[]): NsaQuoteTotals {
  const subtotal = calculateLinesSubtotal(lines);
  const { vatAmount, total } = applyVat(subtotal);
  return { subtotal, discountAmount: 0, vatAmount, total };
}

type NsaQuoteRow = {
  id: string;
  quote_number: string;
  vendor_number: string;
  po_number: string;
  client_name: string;
  client_address: string;
  qbo_customer_id: string | null;
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
    qboCustomerId: row.qbo_customer_id,
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

export async function fetchNsaQuoteById(id: string): Promise<NsaQuote | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from("nsa_quotes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toNsaQuote(data) : null;
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
  qboCustomerId?: string | null;
  jobDescription: string;
  eventDate: string | null;
  lines: LineItem[];
}

export async function saveNsaQuoteDraft(input: SaveNsaQuoteDraftInput): Promise<NsaQuote> {
  const client = requireSupabase();
  const totals = calculateNsaQuoteTotals(input.lines);

  const row = {
    quote_number: input.quoteNumber,
    vendor_number: input.vendorNumber,
    po_number: input.poNumber,
    client_name: input.clientName,
    client_address: input.clientAddress,
    qbo_customer_id: input.qboCustomerId ?? null,
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
  qboCustomerId?: string | null;
  jobDescription: string;
  eventDate: string | null;
  lines: LineItem[];
}

export async function createNsaInvoiceDirect(
  input: CreateNsaInvoiceDirectInput,
): Promise<NsaQuote> {
  const client = requireSupabase();
  const totals = calculateNsaQuoteTotals(input.lines);

  const row = {
    // No formal quote number exists for a direct invoice — reuse the
    // invoice number so quote_number (not-null) still has a sensible value.
    quote_number: input.nsaInvoiceNumber,
    vendor_number: input.vendorNumber,
    po_number: input.poNumber,
    client_name: input.clientName,
    client_address: input.clientAddress,
    qbo_customer_id: input.qboCustomerId ?? null,
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

// Convertible from any stage short of already-invoiced — draft, sent or
// accepted. A quote doesn't have to run the whole Sent -> Accepted ceremony
// before it can be turned into an invoice; sometimes the client just says
// "go ahead" and the paper trail catches up after the fact.
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
    .in("status", ["draft", "sent", "accepted"])
    .select("*")
    .single();
  if (error) throw error;
  return toNsaQuote(data);
}

// Job Sheet -> NSA Quote hand-off (src/lib/jobSheetToNsaQuote.ts). Inserts
// the quote and links it back to the job sheet in one atomic Postgres
// transaction (create_nsa_quote_from_job_sheet, 202608180001) — a row lock
// on the job sheet plus a re-check that it isn't already linked, so two
// rapid clicks or two open tabs can't create two quotes for one job sheet,
// and a partial failure can't leave an orphaned unlinked quote behind. Also
// enforces server-side that this is an African Nomad job — Tuscany SA has
// its own separate flow and must never produce NSA-branded paperwork.
//
// Deliberately takes NO financial numbers — the function reads
// subtotal/discount/VAT/total straight off the job sheet row it locks, so a
// stale in-memory copy (the sheet was edited in another tab after this page
// loaded) can never produce a quote whose lines and totals disagree.
export interface CreateNsaQuoteFromJobSheetInput {
  jobSheetId: string;
  quoteNumber: string;
  vendorNumber: string;
  poNumber: string;
  clientAddress: string;
}

export async function createNsaQuoteFromJobSheet(
  input: CreateNsaQuoteFromJobSheetInput,
): Promise<NsaQuote> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_nsa_quote_from_job_sheet", {
    p_job_sheet_id: input.jobSheetId,
    p_quote_number: input.quoteNumber,
    p_vendor_number: input.vendorNumber,
    p_po_number: input.poNumber,
    p_client_address: input.clientAddress,
  });
  if (error) throw error;
  return toNsaQuote(data as NsaQuoteRow);
}
