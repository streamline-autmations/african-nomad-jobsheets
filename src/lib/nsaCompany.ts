/**
 * NSA Mining (Pty) Ltd's own letterhead, tax and banking details, as they
 * appear on the NSA-branded Quote and Invoice documents.
 *
 * These belong to a third party and are deliberately NOT hard-coded in this
 * repository — they are read from environment variables so the source can be
 * published without disclosing someone else's banking and contact details.
 * Set them in `.env.local` for development and in the Vercel project settings
 * for production; `.env.example` lists every name with a safe placeholder.
 *
 * Every value degrades to an empty string when unset rather than throwing, so
 * a missing variable shows as a blank line on the document instead of taking
 * the whole app down. The banking block is hidden entirely when `bankName` is
 * empty, which is also how Quotes (as opposed to Invoices) suppress it.
 */
const env = import.meta.env;

/**
 * Address lines arrive as a single pipe-separated variable because .env files
 * have no array syntax — "10 Example Street|Suburb, City|0000" renders as
 * three lines. Empty segments are dropped so a trailing separator is harmless.
 */
function addressLinesFromEnv(raw: string): string[] {
  return raw
    .split("|")
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface NsaCompanyDetails {
  name: string;
  addressLines: string[];
  vatRegistrationNo: string;
  email: string;
  phone: string;
  bankName: string;
  bankAccountType: string;
  bankAccountNumber: string;
  bankBranchCode: string;
}

export const NSA_COMPANY: NsaCompanyDetails = {
  name: env.VITE_NSA_COMPANY_NAME ?? "",
  addressLines: addressLinesFromEnv(env.VITE_NSA_ADDRESS_LINES ?? ""),
  vatRegistrationNo: env.VITE_NSA_VAT_NUMBER ?? "",
  email: env.VITE_NSA_EMAIL ?? "",
  phone: env.VITE_NSA_PHONE ?? "",
  bankName: env.VITE_NSA_BANK_NAME ?? "",
  bankAccountType: env.VITE_NSA_BANK_ACCOUNT_TYPE ?? "",
  bankAccountNumber: env.VITE_NSA_BANK_ACCOUNT_NUMBER ?? "",
  bankBranchCode: env.VITE_NSA_BANK_BRANCH_CODE ?? "",
};
