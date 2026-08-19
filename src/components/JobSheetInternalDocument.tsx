import { useRef, useState } from "react";
import { downloadElementAsPdf } from "../lib/pdfDownload";
import { linesToSheetRows, rowHasClient, rowHasSupplier } from "../lib/jobSheetRows";
import { round2 } from "../lib/feeCalculations";
import { errorMessage } from "../lib/errors";
import type { JobSheet } from "../types";

interface JobSheetInternalDocumentProps {
  job: JobSheet;
  companyName: string;
  onClose: () => void;
}

function money(value: number): string {
  return value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The internal job sheet, printed the way the Excel prints.
 *
 * Distinct from JobSheetDocument, which is the client-facing Quote/Invoice and
 * shows client lines only. This one is the working document staff pass around:
 * both column blocks, the supplier names, the mark-up, the fee lines and the
 * profit. It never goes to a mine.
 *
 * Landscape A4 — the sheet is two column blocks wide, and portrait would
 * squeeze it to the point of uselessness.
 */
export function JobSheetInternalDocument({
  job,
  companyName,
  onClose,
}: JobSheetInternalDocumentProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const rows = linesToSheetRows(job.clientLines, job.expenseLines).filter(
    (row) => rowHasClient(row) || rowHasSupplier(row),
  );

  const feeLabel = companyName === "Tuscany SA" ? "Silent partner 10%" : "NSA 10%";
  const feeAmount = companyName === "Tuscany SA" ? job.tuscanyFee : job.nsaFee;

  async function handleDownload() {
    if (!printRef.current) return;
    setDownloadError(null);
    setDownloading(true);
    try {
      const safeCustomer = (job.customerNameRaw || "customer").replace(/[^a-z0-9]+/gi, "-");
      await downloadElementAsPdf(
        printRef.current,
        `Jobsheet-${safeCustomer}-${job.id.slice(0, 8)}.pdf`,
        "landscape",
      );
    } catch (err) {
      setDownloadError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="nsa-doc-overlay">
      <div className="nsa-doc-toolbar no-print">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
        {downloadError && <span className="banner banner-error">{downloadError}</span>}
        <button
          type="button"
          className="btn-secondary"
          disabled={downloading}
          onClick={handleDownload}
        >
          {downloading ? "Downloading…" : "Download PDF"}
        </button>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="nsa-quote-print jobsheet-print" ref={printRef}>
        <div className="jobsheet-print-head">
          <div>
            <h1>JOB SHEET</h1>
            <div className="jobsheet-print-company">{companyName}</div>
          </div>
          <dl className="jobsheet-print-meta">
            <div>
              <dt>Company Name:</dt>
              <dd>{job.customerNameRaw || "—"}</dd>
            </div>
            <div>
              <dt>Job:</dt>
              <dd>{job.jobDescription || "—"}</dd>
            </div>
            <div>
              <dt>Event / Promotion Date:</dt>
              <dd>{job.eventDate ?? "—"}</dd>
            </div>
            <div>
              <dt>Status:</dt>
              <dd>{job.status}</dd>
            </div>
          </dl>
        </div>

        <table className="jobsheet-print-table">
          <thead>
            <tr className="jobsheet-print-groups">
              <th />
              <th colSpan={4}>CLIENT</th>
              <th colSpan={5}>COMPANY EXPENSES</th>
            </tr>
            <tr>
              <th />
              <th>DESCRIPTION</th>
              <th className="num">QTY</th>
              <th className="num">UNIT COST EXCL. VAT</th>
              <th className="num">CE TOTAL</th>
              <th>SUPPLIER ITEMS</th>
              <th className="num">QTY</th>
              <th className="num">CE UNIT COST</th>
              <th className="num">CE TOTAL</th>
              <th>SUPPLIER NAME</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const clientTotal = round2(row.clientQty * row.clientUnitCost);
              const supplierTotal = round2(row.supplierQty * row.supplierUnitCost);
              const hasClient = rowHasClient(row);
              const hasSupplier = rowHasSupplier(row);
              return (
                <tr key={row.id}>
                  <td className="jobsheet-print-gutter">{index + 1}</td>
                  <td>{row.clientDescription}</td>
                  <td className="num">{hasClient ? row.clientQty : ""}</td>
                  <td className="num">{hasClient ? money(row.clientUnitCost) : ""}</td>
                  <td className="num">{hasClient ? money(clientTotal) : ""}</td>
                  <td>{row.supplierDescription}</td>
                  <td className="num">{hasSupplier ? row.supplierQty : ""}</td>
                  <td className="num">{hasSupplier ? money(row.supplierUnitCost) : ""}</td>
                  <td className="num">{hasSupplier ? money(supplierTotal) : ""}</td>
                  <td>{row.vendorName}</td>
                </tr>
              );
            })}

            {/* Derived on the sheet, but printed where the spreadsheet types
                them — inside the supplier list, above the totals. */}
            {job.sibanyeRebate > 0 && (
              <tr className="jobsheet-print-auto">
                <td />
                <td colSpan={4} />
                <td>Sibanye 2.5%</td>
                <td colSpan={2} />
                <td className="num">{money(job.sibanyeRebate)}</td>
                <td />
              </tr>
            )}
            {feeAmount !== 0 && (
              <tr className="jobsheet-print-auto">
                <td />
                <td colSpan={4} />
                <td>{feeLabel}</td>
                <td colSpan={2} />
                <td className="num">{money(feeAmount)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>

        <div className="jobsheet-print-totals">
          <dl>
            <div>
              <dt>Sub Total:</dt>
              <dd>{money(job.clientSubtotal)}</dd>
            </div>
            <div>
              <dt>Vat @ 15%</dt>
              <dd>{money(job.vatAmount)}</dd>
            </div>
            <div className="strong">
              <dt>Total (Incl Vat)</dt>
              <dd>{money(job.clientTotal)}</dd>
            </div>
          </dl>
          <dl>
            <div>
              <dt>Total Expenses:</dt>
              <dd>{money(job.totalCosts)}</dd>
            </div>
            <div className="strong">
              <dt>Profit:</dt>
              <dd>{money(job.netProfit)}</dd>
            </div>
            <div className="strong">
              <dt>Profit Margin</dt>
              <dd>{job.netMarginPct.toFixed(2)}%</dd>
            </div>
          </dl>
        </div>

        <p className="jobsheet-print-footnote">
          Internal costing sheet — not for the client.
        </p>
      </div>
    </div>
  );
}
