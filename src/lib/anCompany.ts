import type { CompanyName } from "../types";

// Placeholder business details for the printed Estimate/Invoice documents —
// unlike NSA_COMPANY (confirmed from Christiaan's real quote/invoice PDFs),
// nobody has supplied African Nomad's or Tuscany SA's real registered
// address, VAT number, or banking details yet. Fill these in with the real
// values before sending a document to an actual client — right now the
// address/VAT lines will visibly read "TODO" as a reminder.
export interface CompanyDetails {
  name: string;
  addressLines: string[];
  vatRegistrationNo: string;
  email: string;
  phone: string;
  bankName?: string;
  bankAccountType?: string;
  bankAccountNumber?: string;
  bankBranchCode?: string;
}

function placeholder() {
  return {
    addressLines: ["TODO: real registered address"],
    vatRegistrationNo: "TODO",
    email: "TODO@example.com",
    phone: "TODO",
  };
}

export const AN_COMPANIES: Record<string, CompanyDetails> = {
  "African Nomad": {
    name: "African Nomad",
    ...placeholder(),
  },
  "Tuscany SA": {
    name: "Tuscany SA",
    ...placeholder(),
  },
};

export function getCompanyDetails(companyName: CompanyName | string): CompanyDetails {
  return (
    AN_COMPANIES[companyName] ?? {
      name: companyName,
      ...placeholder(),
    }
  );
}
