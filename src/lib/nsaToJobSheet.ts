import { calculateJobSheetFinancials } from "./feeCalculations";
import { createJobSheetFromNsaQuote, fetchCompanies } from "./jobSheets";
import type { NsaQuote } from "../nsaTypes";

// The one deliberate coupling point between the NSA Quote System (Component
// 2) and the AN Job Sheet App (Component 1) — everywhere else the two stay
// separate. Automates the hand-off Christiaan used to do by hand: once a
// mine has accepted an NSA quote, AN needs its own real internal Job Sheet
// (Company = African Nomad, Customer = the real mine) to start the QBD
// pipeline. This does not touch qbd_sync_queue directly — it only creates a
// draft job sheet, so the existing human-approval gate in Component 1 still
// applies before anything reaches QuickBooks.
//
// The insert-and-link-back is one atomic database transaction
// (create_job_sheet_from_nsa_quote) rather than two separate client calls —
// see 202608180001_atomic_job_sheet_nsa_quote_handoff.sql. The database also
// enforces the quote must be accepted/invoiced and not already converted,
// not just the UI's canCreateJobSheet check.
export async function convertNsaQuoteToJobSheet(quote: NsaQuote) {
  const companies = await fetchCompanies();
  const africanNomad = companies.find((c) => c.name === "African Nomad");
  if (!africanNomad) {
    throw new Error(
      "Couldn't find the \"African Nomad\" company in the Job Sheet App's companies table.",
    );
  }

  const financials = calculateJobSheetFinancials({
    companyName: africanNomad.name,
    customerName: quote.clientName,
    clientLines: quote.lines,
    expenseLines: [],
  });

  return createJobSheetFromNsaQuote({
    quoteId: quote.id,
    companyId: africanNomad.id,
    customerNameRaw: quote.clientName,
    jobDescription: quote.jobDescription,
    eventDate: quote.eventDate,
    clientLines: quote.lines,
    financials,
  });
}
