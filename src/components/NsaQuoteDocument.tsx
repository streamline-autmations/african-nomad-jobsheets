import { useRef, useState } from "react";
import { DocumentOverlay } from "./DocumentOverlay";
import { round2 } from "../lib/feeCalculations";
import { NSA_COMPANY } from "../lib/nsaCompany";
import { downloadElementAsPdf } from "../lib/pdfDownload";
import type { NsaQuote } from "../nsaTypes";
import nsaLogo from "../assets/nsa-mining-logo.jpg";
import { errorMessage } from "../lib/errors";

interface NsaQuoteDocumentProps {
  quote: NsaQuote;
  /** A quote prints as "QUOTE"; once invoiced, the same data prints as the NSA-branded invoice. */
  docType: "quote" | "invoice";
  onClose: () => void;
}

// Matches the comma thousand-separator formatting QBO's own generated PDF
// uses (e.g. "R 268,000.00"), not just toFixed(2)'s "R 268000.00".
function formatMoney(value: number): string {
  return `R ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Matches the layout of a real NSA Mining QuickBooks Online Estimate PDF
// (Christiaan supplied "Quote 1291 from NSA Mining.pdf" as the reference) as
// closely as reasonably possible, so the downloaded document reads as
// genuinely hers — title/company block top-left, contact info + logo
// top-right, a shaded Bill to/Ship to panel, a quote-details row, the line
// item table, and a totals block.
export function NsaQuoteDocument({ quote, docType, onClose }: NsaQuoteDocumentProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const title = docType === "quote" ? "QUOTE" : "INVOICE";
  const number = docType === "quote" ? quote.quoteNumber : quote.nsaInvoiceNumber ?? "";
  const dateLabel = docType === "quote" ? "Quote date" : "Invoice date";
  const numberLabel = docType === "quote" ? "Quote no." : "Invoice no.";
  const date = docType === "quote" ? quote.createdAt : quote.invoicedAt ?? quote.createdAt;

  async function handleDownload() {
    if (!printRef.current) return;
    setDownloadError(null);
    setDownloading(true);
    try {
      const safeClient = (quote.clientName || "client").replace(/[^a-z0-9]+/gi, "-");
      const safeNumber = (number || quote.id.slice(0, 8)).replace(/[^a-z0-9]+/gi, "-");
      await downloadElementAsPdf(
        printRef.current,
        `${title === "INVOICE" ? "Invoice" : "Quote"}-${safeNumber}-${safeClient}.pdf`,
      );
    } catch (err) {
      setDownloadError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <DocumentOverlay>
      <div className="nsa-doc-toolbar no-print">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
        {downloadError && <span className="banner banner-error">{downloadError}</span>}
        <button type="button" className="btn-secondary" disabled={downloading} onClick={handleDownload}>
          {downloading ? "Downloading…" : "Download PDF"}
        </button>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="nsa-quote-print" ref={printRef}>
        <div className="nsa-doc-header">
          <div className="nsa-doc-title-block">
            <h1>{title}</h1>
            <strong>{NSA_COMPANY.name}</strong>
            {NSA_COMPANY.addressLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div>VAT Registration No. {NSA_COMPANY.vatRegistrationNo}</div>
          </div>
          <div className="nsa-doc-contact-block">
            <div>{NSA_COMPANY.email}</div>
            <div>{NSA_COMPANY.phone}</div>
          </div>
          <img className="nsa-doc-logo" src={nsaLogo} alt="NSA Mining (Pty) Ltd" />
        </div>

        <div className="nsa-doc-bill-ship">
          <div>
            <strong>Bill to</strong>
            <div>{quote.clientName}</div>
            <div className="nsa-doc-address">{quote.clientAddress}</div>
          </div>
          <div>
            <strong>Ship to</strong>
            <div>{quote.clientName}</div>
            <div className="nsa-doc-address">{quote.clientAddress}</div>
          </div>
        </div>

        <div className="nsa-doc-meta">
          <div>
            <strong>{title === "QUOTE" ? "Quote details" : "Invoice details"}</strong>
            <div>
              {numberLabel}: {number}
            </div>
            <div>
              {dateLabel}: {date ? new Date(date).toLocaleDateString("en-ZA") : ""}
            </div>
          </div>
          {docType === "quote" ? (
            <div>Vendor Number: {quote.vendorNumber}</div>
          ) : (
            <div className="nsa-doc-meta-right">
              <div>Purchase Order no: {quote.poNumber || "N/A"}</div>
              <div>
                <strong>Vendor no: {quote.vendorNumber}</strong>
              </div>
            </div>
          )}
        </div>

        <table className="nsa-doc-lines">
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.description}</td>
                <td>{line.qty}</td>
                <td>{formatMoney(line.unitCost)}</td>
                <td>{formatMoney(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="nsa-doc-totals-row">
          {docType === "invoice" && (
            <div className="nsa-doc-banking">
              {NSA_COMPANY.bankName ? (
                <>
                  <div>{NSA_COMPANY.bankName}</div>
                  <div>Type: {NSA_COMPANY.bankAccountType}</div>
                  <div>Acc nr: {NSA_COMPANY.bankAccountNumber}</div>
                  <div>Branch code: {NSA_COMPANY.bankBranchCode}</div>
                </>
              ) : (
                <div>Banking details to be confirmed.</div>
              )}
            </div>
          )}

          <div className="nsa-doc-totals">
            <div>
              <span>Subtotal</span>
              <span>{formatMoney(quote.subtotal)}</span>
            </div>
            {/* Historical quotes (pre-2026-08-19) may carry a stored discount.
                Their VAT was charged on the reduced amount, so the base named
                here still has to be the discounted subtotal or the document
                misstates its own arithmetic. Every new quote stores 0, so on
                anything raised today this is simply the subtotal and no
                discount row prints — matching the real NSA paperwork. */}
            {quote.discountAmount > 0 && (
              <div>
                <span>Discount</span>
                <span>- {formatMoney(quote.discountAmount)}</span>
              </div>
            )}
            <div>
              <span>
                VAT @ 15% on {formatMoney(round2(quote.subtotal - quote.discountAmount))}
              </span>
              <span>{formatMoney(quote.vatAmount)}</span>
            </div>
            <div className="nsa-doc-total-row">
              <span>Total</span>
              <span>{formatMoney(quote.total)}</span>
            </div>
          </div>
        </div>

        {docType === "quote" && (
          <div className="nsa-doc-footer">
            <div>Accepted date</div>
            <div>Accepted by</div>
          </div>
        )}
      </div>
    </DocumentOverlay>
  );
}
