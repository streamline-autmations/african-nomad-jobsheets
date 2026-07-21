// NSA Mining (Pty) Ltd's own company details, as confirmed by Christiaan on
// 2026-07-20 (from a real quote of hers: "Quote 1291 from NSA Mining.pdf").
// These are NSA's details, not African Nomad's — every NSA Quote/Invoice
// document must show only this, never anything about African Nomad.
export const NSA_COMPANY = {
  name: "NSA Mining (Pty) Ltd",
  addressLines: ["10 Koedoe Street", "Greenhills, Randfontein, Gauteng", "1759"],
  vatRegistrationNo: "4210262269",
  email: "amanda.steffen@nsamining.co.za",
  phone: "+27 780956899",
  // From the real reference invoice ("Invoice NSA06384 Beanies 2.pdf"),
  // supplied 2026-07-20. Only shown on the Invoice view, not on Quotes.
  bankName: "Nedbank Drie Riviere",
  bankAccountType: "Current Account",
  bankAccountNumber: "1018706607",
  bankBranchCode: "198765",
} as const;
