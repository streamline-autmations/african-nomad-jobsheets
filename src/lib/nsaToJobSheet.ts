import { fetchCompanies, saveJobSheetDraft } from "./jobSheets";
import { markNsaQuoteConvertedToJobSheet } from "./nsaQuotes";
import type { NsaQuote } from "../nsaTypes";

// The one deliberate coupling point between the NSA Quote System (Component
// 2) and the AN Job Sheet App (Component 1) — everywhere else the two stay
// separate. Automates the hand-off Christiaan used to do by hand: once a
// mine has accepted an NSA quote, AN needs its own real internal Job Sheet
// (Company = African Nomad, Customer = the real mine) to start the QBD
// pipeline. This does not touch qbd_sync_queue directly — it only creates a
// draft job sheet, so the existing human-approval gate in Component 1 still
// applies before anything reaches QuickBooks.
export async function convertNsaQuoteToJobSheet(quote: NsaQuote) {
  const companies = await fetchCompanies();
  const africanNomad = companies.find((c) => c.name === "African Nomad");
  if (!africanNomad) {
    throw new Error(
      "Couldn't find the \"African Nomad\" company in the Job Sheet App's companies table.",
    );
  }

  const jobSheet = await saveJobSheetDraft({
    companyId: africanNomad.id,
    companyName: africanNomad.name,
    customerId: null,
    customerNameRaw: quote.clientName,
    jobDescription: quote.jobDescription,
    eventDate: quote.eventDate,
    clientLines: quote.lines,
    expenseLines: [],
  });

  await markNsaQuoteConvertedToJobSheet(quote.id, jobSheet.id);
  return jobSheet;
}
