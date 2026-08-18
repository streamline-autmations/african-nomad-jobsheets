import { markJobSheetConvertedToNsaQuote } from "./jobSheets";
import { saveNsaQuoteDraft } from "./nsaQuotes";
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

  const quote = await saveNsaQuoteDraft({
    quoteNumber: input.quoteNumber.trim(),
    vendorNumber: input.vendorNumber.trim(),
    poNumber: input.poNumber.trim(),
    clientName: jobSheet.customerNameRaw,
    clientAddress: input.clientAddress.trim(),
    jobDescription: jobSheet.jobDescription,
    eventDate: jobSheet.eventDate,
    // Only the client side crosses over. Expense lines are what AN pays its
    // suppliers and must never appear on a document the mine sees — see the
    // NSA relationship notes in AN_JOBSHEET_SYSTEM_CONTEXT.md.
    lines: jobSheet.clientLines,
    // The discount does cross over, unlike the NSA/Tuscany fees. Those are
    // internal profit splits; this is a real reduction to what the mine is
    // billed, and the NSA document is the only one the mine ever sees — so if
    // it isn't here, the client never actually receives the discount that AN's
    // books have already given away.
    discountAmount: jobSheet.sibanyeDiscount,
  });

  await markJobSheetConvertedToNsaQuote(jobSheet.id, quote.id);
  return quote;
}
