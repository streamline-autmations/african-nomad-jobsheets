import { getCompanyDetails } from "../lib/anCompany";
import type { JobSheet } from "../types";

interface JobSheetDocumentProps {
  job: JobSheet;
  companyName: string;
  onClose: () => void;
}

function formatMoney(value: number): string {
  return `R ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Client-facing Quote/Invoice for an AN Job Sheet — shares the NSA Quote
// document's print layout/CSS (.nsa-quote-print etc. are generic despite the
// name) so "Print / Save as PDF" behaves identically across both document
// types in the app.
export function JobSheetDocument({ job, companyName, onClose }: JobSheetDocumentProps) {
  const isInvoiced = Boolean(job.qbdInvoiceTxnId);
  const company = getCompanyDetails(companyName);
  const title = isInvoiced ? "INVOICE" : "QUOTE";
  const date = isInvoiced ? job.syncedAt ?? job.createdAt : job.createdAt;

  return (
    <div className="nsa-doc-overlay">
      <div className="nsa-doc-toolbar no-print">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="nsa-quote-print">
        <div className="nsa-doc-header">
          <div className="nsa-doc-title-block">
            <h1>{title}</h1>
            <strong>{company.name}</strong>
            {company.addressLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
            <div>VAT Registration No. {company.vatRegistrationNo}</div>
          </div>
          <div className="nsa-doc-contact-block">
            <div>{company.email}</div>
            <div>{company.phone}</div>
          </div>
        </div>

        <div className="nsa-doc-bill-ship">
          <div>
            <strong>Bill to</strong>
            <div>{job.customerNameRaw || "Unnamed customer"}</div>
          </div>
          <div>
            <strong>Job</strong>
            <div className="nsa-doc-address">{job.jobDescription || "—"}</div>
          </div>
        </div>

        <div className="nsa-doc-meta">
          <div>
            <strong>{isInvoiced ? "Invoice details" : "Quote details"}</strong>
            <div>Job sheet ref: {job.id.slice(0, 8)}</div>
            <div>{isInvoiced ? "Invoice date" : "Quote date"}: {date ? new Date(date).toLocaleDateString("en-ZA") : ""}</div>
            {job.eventDate && <div>Event date: {new Date(job.eventDate).toLocaleDateString("en-ZA")}</div>}
          </div>
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
            {job.clientLines.map((line) => (
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
          {isInvoiced && (
            <div className="nsa-doc-banking">
              {company.bankName ? (
                <>
                  <div>{company.bankName}</div>
                  <div>Type: {company.bankAccountType}</div>
                  <div>Acc nr: {company.bankAccountNumber}</div>
                  <div>Branch code: {company.bankBranchCode}</div>
                </>
              ) : (
                <div>Banking details to be confirmed.</div>
              )}
            </div>
          )}

          <div className="nsa-doc-totals">
            {job.sibanyeDiscount > 0 && (
              <div>
                <span>Sibanye discount (2.5%)</span>
                <span>- {formatMoney(job.sibanyeDiscount)}</span>
              </div>
            )}
            <div>
              <span>Subtotal</span>
              <span>{formatMoney(job.clientSubtotal - job.sibanyeDiscount)}</span>
            </div>
            <div>
              <span>VAT @ 15%</span>
              <span>{formatMoney(job.vatAmount)}</span>
            </div>
            <div className="nsa-doc-total-row">
              <span>Total</span>
              <span>{formatMoney(job.clientTotal)}</span>
            </div>
          </div>
        </div>

        {!isInvoiced && (
          <div className="nsa-doc-footer">
            <div>Accepted date</div>
            <div>Accepted by</div>
          </div>
        )}
      </div>
    </div>
  );
}
