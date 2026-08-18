import type { LineItem } from "./types";

// Deliberately separate from JobSheet/JobSheetFinancials — the NSA Quote
// System is a standalone tool with its own data model, per Christiaan's
// 2026-07-20 decision to keep it apart from the AN Job Sheet App.

export type NsaQuoteStatus = "draft" | "sent" | "accepted" | "invoiced";

export interface NsaQuote {
  id: string;
  quoteNumber: string;
  vendorNumber: string;
  poNumber: string;
  clientName: string;
  clientAddress: string;
  jobDescription: string;
  eventDate: string | null;
  status: NsaQuoteStatus;
  lines: LineItem[];
  subtotal: number;
  /** Reduction off the subtotal, applied before VAT. 0 on most quotes. */
  discountAmount: number;
  vatAmount: number;
  total: number;
  nsaInvoiceNumber: string | null;
  /** Set once "Create AN Job Sheet" has been run for this quote, so the UI won't duplicate it. */
  anJobSheetId: string | null;
  createdAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  invoicedAt: string | null;
}
