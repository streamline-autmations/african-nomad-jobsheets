import { createNsaQuoteFromJobSheet } from "./nsaQuotes";
import type { JobSheet } from "../types";

// The second coupling point between the AN Job Sheet App (Component 1) and the
// NSA Quote System (Component 2), and the mirror image of nsaToJobSheet.ts.
//
// nsaToJobSheet handles "the mine accepted an NSA quote, now AN needs its own
// internal job sheet". This handles the direction Christiaan actually works in
// most of the time: a mine asks for something, he builds a quick job sheet
// first so the costs and margin are real, and only then produces the
// client-facing quote. Before this existed, every line had to be retyped into
// the NSA quote form by hand.
//
// The quote is created as a `draft`, so the existing human gates still apply —
// nothing is sent to a mine without someone clicking through Mark as Sent.
//
// The insert-and-link-back is one atomic database transaction
// (create_nsa_quote_from_job_sheet) rather than two separate client calls —
// see 202608180001_atomic_job_sheet_nsa_quote_handoff.sql for why that
// matters: a partial failure used to leave an orphaned, unlinked quote
// behind, and nothing stopped two rapid clicks from creating two quotes for
// the same job sheet.

export interface ConvertJobSheetToNsaQuoteInput {
  /**
   * NSA's own quote number. Free text and required, deliberately: we don't
   * know her real numbering sequence and must never collide with it, so a
   * human types the number NSA's system would assign. Same reasoning as the
   * original NsaQuoteForm.
   */
  quoteNumber: string;
  /** NSA's vendor number with this mine. Prefilled from the last quote to this client. */
  vendorNumber: string;
  /** The mine's PO number if they've issued one. Blank renders as "N/A". */
  poNumber: string;
  /** Postal address for the Bill-to block. Prefilled from the last quote to this client. */
  clientAddress: string;
}

export async function convertJobSheetToNsaQuote(
  jobSheet: JobSheet,
  input: ConvertJobSheetToNsaQuoteInput,
) {
  if (jobSheet.nsaQuoteId) {
    throw new Error(
      "This job sheet has already been turned into an NSA quote — open the NSA Quotes tab to find it.",
    );
  }
  if (jobSheet.clientLines.length === 0) {
    throw new Error(
      "This job sheet has no client lines, so there is nothing to quote. Add what you're charging the mine first.",
    );
  }

  // Only the client side crosses over — expense lines are what AN pays its
  // suppliers and must never appear on a document the mine sees (see the NSA
  // relationship notes in AN_JOBSHEET_SYSTEM_CONTEXT.md) — and the RPC pulls
  // lines and totals (including the Sibanye discount) straight off the job
  // sheet row it locks, not from this in-memory copy, so they can't drift
  // apart from an edit made in another tab. See
  // 202608180001_atomic_job_sheet_nsa_quote_handoff.sql.
  return createNsaQuoteFromJobSheet({
    jobSheetId: jobSheet.id,
    quoteNumber: input.quoteNumber.trim(),
    vendorNumber: input.vendorNumber.trim(),
    poNumber: input.poNumber.trim(),
    clientAddress: input.clientAddress.trim(),
  });
}
