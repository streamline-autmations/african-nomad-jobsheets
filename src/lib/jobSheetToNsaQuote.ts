import { createNsaInvoiceFromJobSheet, createNsaQuoteFromJobSheet, pushNsaQuoteToQbo } from "./nsaQuotes";
import type { JobSheet } from "../types";
import type { NsaQuote } from "../nsaTypes";

// The second coupling point between the AN Job Sheet App (Component 1) and the
// NSA Quote System (Component 2), and the mirror image of nsaToJobSheet.ts.
//
// nsaToJobSheet handles "the mine accepted an NSA quote, now AN needs its own
// internal job sheet". This handles the direction Christiaan actually works in
// most of the time: a mine asks for something, he builds a quick job sheet
// first so the costs and margin are real, and only then produces the
// client-facing quote or invoice — and, since NSA's real QuickBooks Online
// company is connected, pushes it there immediately in the same action
// rather than requiring a separate "Push to QuickBooks Online" click
// afterward. Before this existed, every line had to be retyped into the NSA
// quote form by hand.
//
// The internal record is created as `draft` (or `invoiced` for the direct-
// invoice path) via one atomic database transaction
// (create_nsa_quote_from_job_sheet / create_nsa_invoice_from_job_sheet) — see
// 202608180001_atomic_job_sheet_nsa_quote_handoff.sql for why that matters: a
// partial failure used to leave an orphaned, unlinked quote behind, and
// nothing stopped two rapid clicks from creating two quotes for the same job
// sheet.
//
// No quote/invoice number is typed here any more: QBO assigns its own
// DocNumber under the company's real numbering the moment this pushes, and
// that's what ends up on the row — see push-nsa-quote.ts. If the push step
// fails (network blip, QBO down), the internal record still exists with no
// number yet; pushError tells the caller to point staff at the "Push to
// QuickBooks Online" button in the NSA Quotes tab to retry, rather than
// losing the draft.

export interface ConvertJobSheetToNsaDocInput {
  /** NSA's vendor number with this mine. Prefilled from the linked QBO customer, or the last quote to this client. */
  vendorNumber: string;
  /** The mine's PO number if they've issued one. Blank renders as "N/A". */
  poNumber: string;
  /** Postal address for the Bill-to block. Prefilled from the linked QBO customer, or the last quote to this client. */
  clientAddress: string;
}

export interface ConvertJobSheetToNsaDocResult {
  quote: NsaQuote;
  /** Set only if the internal record was created but the immediate QBO push failed. */
  pushError: string | null;
}

function assertConvertible(jobSheet: JobSheet, docLabel: string) {
  if (jobSheet.nsaQuoteId) {
    throw new Error(
      `This job sheet has already been turned into an NSA ${docLabel === "invoice" ? "quote/invoice" : "quote"} — open the NSA Quotes tab to find it.`,
    );
  }
  if (jobSheet.clientLines.length === 0) {
    throw new Error(
      `This job sheet has no client lines, so there is nothing to ${docLabel}. Add what you're charging the mine first.`,
    );
  }
}

export async function convertJobSheetToNsaQuote(
  jobSheet: JobSheet,
  input: ConvertJobSheetToNsaDocInput,
): Promise<ConvertJobSheetToNsaDocResult> {
  assertConvertible(jobSheet, "quote");

  // Only the client side crosses over — expense lines are what AN pays its
  // suppliers and must never appear on a document the mine sees (see the NSA
  // relationship notes in AN_JOBSHEET_SYSTEM_CONTEXT.md) — and the RPC pulls
  // lines and totals (including the Sibanye discount) straight off the job
  // sheet row it locks, not from this in-memory copy, so they can't drift
  // apart from an edit made in another tab.
  const quote = await createNsaQuoteFromJobSheet({
    jobSheetId: jobSheet.id,
    quoteNumber: "",
    vendorNumber: input.vendorNumber.trim(),
    poNumber: input.poNumber.trim(),
    clientAddress: input.clientAddress.trim(),
  });

  try {
    const pushed = await pushNsaQuoteToQbo(quote.id);
    return { quote: { ...quote, quoteNumber: pushed.qboDocNumber, qboEstimateId: pushed.qboId }, pushError: null };
  } catch (err) {
    return { quote, pushError: err instanceof Error ? err.message : String(err) };
  }
}

export async function convertJobSheetToNsaInvoice(
  jobSheet: JobSheet,
  input: ConvertJobSheetToNsaDocInput,
): Promise<ConvertJobSheetToNsaDocResult> {
  assertConvertible(jobSheet, "invoice");

  const quote = await createNsaInvoiceFromJobSheet({
    jobSheetId: jobSheet.id,
    vendorNumber: input.vendorNumber.trim(),
    poNumber: input.poNumber.trim(),
    clientAddress: input.clientAddress.trim(),
  });

  try {
    const pushed = await pushNsaQuoteToQbo(quote.id);
    return {
      quote: {
        ...quote,
        quoteNumber: pushed.qboDocNumber,
        nsaInvoiceNumber: pushed.qboDocNumber,
        qboInvoiceId: pushed.qboId,
      },
      pushError: null,
    };
  } catch (err) {
    return { quote, pushError: err instanceof Error ? err.message : String(err) };
  }
}
