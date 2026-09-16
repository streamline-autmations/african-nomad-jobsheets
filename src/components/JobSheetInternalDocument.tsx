import { useLayoutEffect, useRef, useState } from "react";
import { DocumentOverlay } from "./DocumentOverlay";
import { downloadElementAsPdf } from "../lib/pdfDownload";
import { linesToSheetRows, rowHasClient, rowHasSupplier, supplierCostByClientRow } from "../lib/jobSheetRows";
import { round2 } from "../lib/feeCalculations";
import { markupPctFromTotals } from "../lib/markup";
import { errorMessage } from "../lib/errors";
import { useLineItemPhotoUrls } from "../lib/useLineItemPhotoUrls";
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

  // Grouping (supplierCostByClientRow) has to run on the *full* row list,
  // blank separators included — a blank row is what stops trailing
  // unattributed costs piling onto the last client line (see
  // jobSheetRows.supplierCostByClientRow). Filtering blanks out for the
  // printed table happens after, on the already-computed cost per row, not
  // before.
  const rawRows = linesToSheetRows(job.clientLines, job.expenseLines);
  const { costs: supplierCosts } = supplierCostByClientRow(rawRows);
  const rows = rawRows
    .map((row, index) => ({ row, cost: supplierCosts[index] ?? 0 }))
    .filter(({ row }) => rowHasClient(row) || rowHasSupplier(row));

  const photoUrls = useLineItemPhotoUrls(rawRows.flatMap((r) => r.photoPaths));

  const feeLabel = companyName === "Tuscany SA" ? "Silent partner 10%" : "NSA 10%";
  const feeAmount = companyName === "Tuscany SA" ? job.tuscanyFee : job.nsaFee;

  // One job sheet is one page. The sheet is laid out at exactly the printable
  // width of a landscape A4 page (see .jobsheet-print), so the height it has
  // in the preview is the height it will have on paper — measure it, and hand
  // the print stylesheet the factor that pulls it back inside the 190mm of
  // printable height. Chrome fires beforeprint for Ctrl+P as well as for the
  // button, so a sheet edited between opening the preview and printing still
  // measures correctly.
  //
  // Floored rather than allowed to shrink without limit: past roughly half
  // size nobody can read the thing, and a genuinely enormous sheet is more
  // honestly two pages than one unreadable one.
  const printRefScale = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = printRefScale.current;
    if (!el) return;
    function fitToOnePage() {
      if (!el) return;
      el.style.setProperty("--print-fit", "1");
      const styles = getComputedStyle(el);
      const printable = parseFloat(styles.getPropertyValue("--print-page-height"));
      const content =
        el.scrollHeight -
        parseFloat(styles.paddingTop) -
        parseFloat(styles.paddingBottom);
      if (!printable || content <= 0) return;
      // 3% back off the printable height. Chrome paginates on the zoomed
      // layout's own fractional heights, and a sheet measured to land exactly
      // on the boundary still tipped onto a second page.
      const fit = Math.max(0.5, Math.min(1, (printable * 0.97) / content));
      el.style.setProperty("--print-fit", String(fit));
    }
    fitToOnePage();
    window.addEventListener("beforeprint", fitToOnePage);
    return () => window.removeEventListener("beforeprint", fitToOnePage);
  });

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
    <DocumentOverlay orientation="landscape">
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

      <div
        className="nsa-quote-print jobsheet-print"
        ref={(node) => {
          printRef.current = node;
          printRefScale.current = node;
        }}
      >
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
              <th colSpan={5}>CLIENT</th>
              <th colSpan={5}>COMPANY EXPENSES</th>
            </tr>
            <tr>
              <th />
              <th>DESCRIPTION</th>
              <th className="num">QTY</th>
              <th className="num">UNIT COST EXCL. VAT</th>
              <th className="num">CE TOTAL</th>
              <th className="num">MARK-UP</th>
              <th>SUPPLIER ITEMS</th>
              <th className="num">QTY</th>
              <th className="num">CE UNIT COST</th>
              <th className="num">CE TOTAL</th>
              <th>SUPPLIER NAME</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, cost }, index) => {
              const clientTotal = round2(row.clientQty * row.clientUnitCost);
              const supplierTotal = round2(row.supplierQty * row.supplierUnitCost);
              const hasClient = rowHasClient(row);
              const hasSupplier = rowHasSupplier(row);
              const markup = hasClient ? markupPctFromTotals(clientTotal, cost) : null;
              return (
                <tr key={row.id}>
                  <td className="jobsheet-print-gutter">{index + 1}</td>
                  <td>
                    {row.clientDescription}
                    {row.photoPaths.length > 0 && (
                      <div className="jobsheet-print-photos">
                        {row.photoPaths.map((path) =>
                          photoUrls[path] ? (
                            <img key={path} src={photoUrls[path]} crossOrigin="anonymous" alt="" />
                          ) : null,
                        )}
                      </div>
                    )}
                  </td>
                  <td className="num">{hasClient ? row.clientQty : ""}</td>
                  <td className="num">{hasClient ? money(row.clientUnitCost) : ""}</td>
                  <td className="num">{hasClient ? money(clientTotal) : ""}</td>
                  <td className="num">{markup !== null ? `${markup.toFixed(0)}%` : ""}</td>
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
                <td colSpan={5} />
                <td>Sibanye 2.5%</td>
                <td colSpan={2} />
                <td className="num">{money(job.sibanyeRebate)}</td>
                <td />
              </tr>
            )}
            {feeAmount !== 0 && (
              <tr className="jobsheet-print-auto">
                <td />
                <td colSpan={5} />
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
            <div>
              <dt>Gross profit:</dt>
              <dd>{money(job.grossProfit)}</dd>
            </div>
            <div>
              <dt>Gross margin:</dt>
              <dd>{job.profitMarginPct.toFixed(2)}%</dd>
            </div>
            <div>
              <dt>{feeLabel}:</dt>
              <dd>{money(feeAmount)}</dd>
            </div>
            <div className="strong">
              <dt>Net profit:</dt>
              <dd>{money(job.netProfit)}</dd>
            </div>
            <div className="strong">
              <dt>Net margin:</dt>
              <dd>{job.netMarginPct.toFixed(2)}%</dd>
            </div>
          </dl>
        </div>

        <p className="jobsheet-print-footnote">
          Internal costing sheet — not for the client.
        </p>
      </div>
    </DocumentOverlay>
  );
}
