/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;

  // Letterhead, tax and banking details for the NSA-branded Quote/Invoice
  // documents. Kept out of source because they belong to a third party —
  // see src/lib/nsaCompany.ts.
  readonly VITE_NSA_COMPANY_NAME: string;
  /** Pipe-separated, one document line per segment. */
  readonly VITE_NSA_ADDRESS_LINES: string;
  readonly VITE_NSA_VAT_NUMBER: string;
  readonly VITE_NSA_EMAIL: string;
  readonly VITE_NSA_PHONE: string;
  readonly VITE_NSA_BANK_NAME: string;
  readonly VITE_NSA_BANK_ACCOUNT_TYPE: string;
  readonly VITE_NSA_BANK_ACCOUNT_NUMBER: string;
  readonly VITE_NSA_BANK_BRANCH_CODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
