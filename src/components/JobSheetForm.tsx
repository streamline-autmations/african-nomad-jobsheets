import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { CompanySelect } from "./CompanySelect";
import { JobSheetLinesGrid } from "./JobSheetLinesGrid";
import { JobSheetInternalDocument } from "./JobSheetInternalDocument";
import { JobSheetDocument } from "./JobSheetDocument";
import { withLineTotal } from "../lib/feeCalculations";
import { linesToSheetRows, sheetRowsToLines, type SheetRow } from "../lib/jobSheetRows";
import {
  calculateJobSheetEditFinancials,
  copyJobSheet,
  fetchCommonExpenses,
  fetchCompanies,
  fetchJobSheetById,
  isJobSheetEditable,
  saveJobSheet,
  type EditableJobSheet,
} from "../lib/jobSheets";
import {
  nsaQboCustomerLabel,
  syncAndFetchNsaQboCustomers,
  type NsaQboCustomer,
} from "../lib/nsaQboCustomers";
import type { CommonExpense, Company, JobSheet } from "../types";
import { errorMessage } from "../lib/errors";

interface JobSheetFormProps {
  /** When set, loads that existing sheet for editing instead of starting blank
   * (e.g. an AN Job Sheet created from an NSA Quote, which has no expenses yet). */
  editJobSheetId?: string | null;
  /** Called after a successful draft edit — lets the caller navigate
   * back (e.g. to Approvals) instead of leaving a stale editing session open. */
  onEditSaved?: () => void;
  /** Shown as a banner above the form, e.g. after opening a fresh copy. */
  notice?: string | null;
  /** Called with the new draft's id once "Copy job sheet" has saved it, so
   * the caller can switch the editor over to the copy. */
  onCopied?: (id: string) => void;
}

/** Lets the app header's "Copy Job Sheet" button run the same copy as the
 * form's own button, from whatever is on screen. */
export interface JobSheetFormHandle {
  copy: () => void;
}

export const JobSheetForm = forwardRef<JobSheetFormHandle, JobSheetFormProps>(function JobSheetForm(
  { editJobSheetId, onEditSaved, notice, onCopied },
  ref,
) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [commonExpenses, setCommonExpenses] = useState<CommonExpense[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingSheet, setEditingSheet] = useState<EditableJobSheet>();
  const [companyId, setCompanyId] = useState("");
  const [customerNameRaw, setCustomerNameRaw] = useState("");
  // True means "not in QuickBooks yet, type the name" — the customer picker
  // below is the real QBO customer mirror (nsa_qbo_customers), not the old
  // customers table (that one was a QBD mirror that was never actually kept
  // in sync with anything and has been retired from this form).
  const [isNewCustomer, setIsNewCustomer] = useState(false);

  // Real customers mirrored from the connected QuickBooks Online company
  // (see api/qbo/sync-nsa-customers.ts). Linking a job sheet to one of these
  // is what lets the eventual NSA quote/invoice hand-off (ApprovalView)
  // auto-fill vendor number and address instead of retyping them.
  const [qboCustomers, setQboCustomers] = useState<NsaQboCustomer[]>([]);
  const [qboCustomersError, setQboCustomersError] = useState<string | null>(null);
  const [syncingQboCustomers, setSyncingQboCustomers] = useState(true);
  const [selectedQboCustomerId, setSelectedQboCustomerId] = useState<string | null>(null);
  const [staleCustomerNotice, setStaleCustomerNotice] = useState<string | null>(null);

  const [jobDescription, setJobDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  // The form works in sheet rows — the CLIENT and COMPANY EXPENSES columns
  // side by side, as the real spreadsheet lays them out. Split back into the
  // two arrays the database and the QBD pipeline actually store only at save
  // time; see lib/jobSheetRows.ts.
  const [rows, setRows] = useState<SheetRow[]>(() => linesToSheetRows([], []));

  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  // State lags a fast double-click; this doesn't.
  const copyInFlight = useRef(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The header's Copy button sits a long way above the form's banners, so an
  // error has to come into view or the click looks like it did nothing.
  const saveErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (saveError) saveErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [saveError]);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showQuotePreview, setShowQuotePreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCompanies(), fetchCommonExpenses()])
      .then(([companiesData, expensesData]) => {
        if (cancelled) return;
        setCompanies(companiesData);
        setCommonExpenses(expensesData);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Every time this form opens, it syncs from QuickBooks for real — no
  // staleness check, no manual button. A failed sync still falls back to
  // whatever's already in the mirror rather than leaving the picker empty.
  useEffect(() => {
    let cancelled = false;
    setSyncingQboCustomers(true);
    syncAndFetchNsaQboCustomers()
      .then(({ customers, syncError }) => {
        if (cancelled) return;
        setQboCustomers(customers);
        setQboCustomersError(syncError);
      })
      .catch((err: unknown) => {
        if (!cancelled) setQboCustomersError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setSyncingQboCustomers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!editJobSheetId) return;
    let cancelled = false;
    fetchJobSheetById(editJobSheetId)
      .then((job) => {
        if (cancelled) return;
        if (!isJobSheetEditable(job.status)) {
          throw new Error(`This job sheet is now ${job.status}. Open it in Approved Job Sheets to review its status.`);
        }
        setEditingSheet({ ...job, status: job.status });
        setCompanyId(job.companyId);
        setCustomerNameRaw(job.customerNameRaw);
        setIsNewCustomer(job.qboCustomerId === null);
        setSelectedQboCustomerId(job.qboCustomerId);
        setJobDescription(job.jobDescription);
        setEventDate(job.eventDate ?? "");
        setRows(linesToSheetRows(job.clientLines, job.expenseLines));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [editJobSheetId]);

  const editingId = editingSheet?.id;
  const editingApproved = editingSheet?.status === "approved";
  const storedCustomer = editingApproved && editingSheet.qboCustomerId ? editingSheet : null;
  const loadingEditor = Boolean(editJobSheetId && editJobSheetId !== editingId);

  // A draft reopened after QuickBooks renamed, merged or deleted its customer
  // still carries the old name and Id. The name drives the Sibanye 2.5%, and
  // a dead Id makes the QBO push fail, so bring both in line with the fresh
  // sync. Only acts on a sync that actually succeeded — on a failed sync the
  // mirror may just be stale, not the job sheet.
  useEffect(() => {
    if (editingApproved || syncingQboCustomers || loadingEditor || qboCustomersError) return;
    if (isNewCustomer || !selectedQboCustomerId || qboCustomers.length === 0) return;
    const customer = qboCustomers.find((c) => c.qboCustomerId === selectedQboCustomerId);
    if (!customer) {
      setStaleCustomerNotice(
        `"${customerNameRaw}" is no longer in QuickBooks — pick the customer again before saving.`,
      );
      setSelectedQboCustomerId(null);
      return;
    }
    const label = nsaQboCustomerLabel(customer, qboCustomers);
    if (label !== customerNameRaw) setCustomerNameRaw(label);
  }, [
    editingApproved,
    syncingQboCustomers,
    loadingEditor,
    qboCustomersError,
    isNewCustomer,
    selectedQboCustomerId,
    qboCustomers,
    customerNameRaw,
  ]);

  const selectedCompany = companies.find((c) => c.id === companyId);

  const { clientLines, expenseLines } = useMemo(() => sheetRowsToLines(rows), [rows]);

  const financials = useMemo(() => {
    return calculateJobSheetEditFinancials({
      companyId,
      companyName: selectedCompany?.name ?? "",
      customerName: customerNameRaw,
      clientLines: clientLines.map(withLineTotal),
      expenseLines: expenseLines.map(withLineTotal),
    }, editingSheet);
  }, [companyId, selectedCompany, customerNameRaw, clientLines, expenseLines, editingSheet]);

  // A print/download preview needs a full JobSheet shape, but this form
  // works from loose draft state that may not be saved yet — so this fills
  // in the fields a real saved row would have with drafty placeholders
  // rather than requiring a save first just to see what it'll look like.
  const draftJobSheet: JobSheet = useMemo(
    () => ({
      ...financials,
      id: editingId ?? "draft",
      companyId,
      customerId: null,
      customerNameRaw,
      qboCustomerId: selectedQboCustomerId,
      jobDescription,
      eventDate: eventDate || null,
      status: "draft",
      clientLines: clientLines.map(withLineTotal),
      expenseLines: expenseLines.map(withLineTotal),
      qbdEstimateTxnId: null,
      qbdInvoiceTxnId: null,
      nsaQuoteId: null,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      syncedAt: null,
    }),
    [
      editingId,
      companyId,
      customerNameRaw,
      selectedQboCustomerId,
      jobDescription,
      eventDate,
      clientLines,
      expenseLines,
      financials,
    ],
  );

  function resetForm() {
    setCompanyId("");
    setCustomerNameRaw("");
    setIsNewCustomer(false);
    setSelectedQboCustomerId(null);
    setStaleCustomerNotice(null);
    setJobDescription("");
    setEventDate("");
    setRows(linesToSheetRows([], []));
  }

  function validationError(): string | null {
    if (!selectedCompany) return "Select a company before saving.";
    if (!isNewCustomer && !selectedQboCustomerId) {
      return "Select a customer, or tick \"this customer isn't in QuickBooks yet\".";
    }
    if (isNewCustomer && !customerNameRaw.trim()) return "Type the new customer's name.";
    return null;
  }

  // What's on screen, ready for saveJobSheet / copyJobSheet.
  function formInput() {
    return {
      companyId,
      companyName: selectedCompany?.name ?? "",
      customerId: null,
      customerNameRaw,
      qboCustomerId: isNewCustomer ? null : selectedQboCustomerId,
      jobDescription,
      eventDate: eventDate || null,
      clientLines: clientLines.map(withLineTotal),
      expenseLines: expenseLines.map(withLineTotal),
    };
  }

  async function handleSave() {
    setSaveError(null);
    setSaveMessage(null);

    const invalid = validationError();
    if (invalid) {
      setSaveError(invalid);
      return;
    }

    setSaving(true);
    try {
      const saved = await saveJobSheet(formInput(), editingSheet);
      if (editingApproved) {
        setEditingSheet({ ...saved, status: "approved" });
        setSaveMessage("Approved job sheet updated.");
      } else if (editingId) {
        setSaveMessage("Draft updated.");
        onEditSaved?.();
      } else {
        setSaveMessage("Draft saved.");
        resetForm();
      }
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Copies what's on screen — including edits not saved yet, which then live
  // in the copy only; the original keeps whatever it was last saved with. A
  // sheet that was never saved is saved as a draft first, so "copy" always
  // leaves two job sheets behind: the original and the copy.
  async function handleCopy() {
    if (loadingEditor || loadError || saving || copyInFlight.current) return;
    setSaveError(null);
    setSaveMessage(null);

    const invalid = validationError();
    if (invalid) {
      setSaveError(invalid);
      return;
    }

    const who = customerNameRaw || "this customer";
    const confirmed = window.confirm(
      editingId
        ? `Copy this job sheet for ${who}? A new draft copy will be created and opened.`
        : `This job sheet for ${who} isn't saved yet. Save it as a draft and make a copy of it? ` +
            "The copy will be opened.",
    );
    if (!confirmed) return;

    copyInFlight.current = true;
    setCopying(true);
    try {
      if (!editingId) {
        const saved = await saveJobSheet(formInput());
        // So a retry after a failed copy doesn't save the original twice.
        setEditingSheet({ ...saved, status: "draft" });
      }
      const copy = await copyJobSheet(formInput());
      onCopied?.(copy.id);
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      copyInFlight.current = false;
      setCopying(false);
    }
  }

  useImperativeHandle(ref, () => ({ copy: () => void handleCopy() }));

  if (loadError) {
    return (
      <div className="banner banner-error">
        Couldn&apos;t load the editor: {loadError}
      </div>
    );
  }

  if (loadingEditor) {
    return <p>Loading job sheet…</p>;
  }

  return (
    <div className="job-sheet-form">
      {notice && <div className="banner banner-success">{notice}</div>}
      {editingApproved ? (
        <div className="banner banner-warning">
          Editing an approved job sheet. Changes apply to the internal sheet only. Existing
          NSA documents and QuickBooks records, including pending Desktop entries, keep their original values.
        </div>
      ) : editingId && (
        <div className="banner">Editing an existing draft — changes replace what&apos;s there.</div>
      )}

      <div className="form-section-heading">
        <h3>Job details</h3>
        {!editingApproved && (
          <p className="section-description">
            The job description becomes the Job name in QuickBooks.
          </p>
        )}
      </div>

      <div className="form-grid">
        <CompanySelect companies={companies} value={companyId} onChange={setCompanyId} />

        <div className="field">
          <span>Customer</span>

          {!isNewCustomer && (
            <select
              value={selectedQboCustomerId ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                const customer = qboCustomers.find((c) => c.qboCustomerId === id);
                const name = storedCustomer?.qboCustomerId === id
                  ? storedCustomer.customerNameRaw
                  : customer && nsaQboCustomerLabel(customer, qboCustomers);
                if (name === undefined) return;
                setStaleCustomerNotice(null);
                setSelectedQboCustomerId(id);
                setCustomerNameRaw(name);
              }}
              required
            >
              <option value="" disabled>
                {syncingQboCustomers ? "Syncing from QuickBooks…" : "Select a customer…"}
              </option>
              {storedCustomer && (
                <option value={storedCustomer.qboCustomerId ?? ""}>{storedCustomer.customerNameRaw}</option>
              )}
              {qboCustomers.filter((customer) => customer.qboCustomerId !== storedCustomer?.qboCustomerId).map((customer) => (
                <option key={customer.qboCustomerId} value={customer.qboCustomerId}>
                  {nsaQboCustomerLabel(customer, qboCustomers)}
                </option>
              ))}
            </select>
          )}

          {isNewCustomer && (
            <input
              type="text"
              placeholder="Type the new customer's name"
              value={customerNameRaw}
              onChange={(e) => setCustomerNameRaw(e.target.value)}
              required
            />
          )}

          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={isNewCustomer}
              onChange={(e) => {
                setIsNewCustomer(e.target.checked);
                setSelectedQboCustomerId(null);
                setCustomerNameRaw("");
              }}
            />
            This customer isn&apos;t in QuickBooks yet
          </label>

          {!isNewCustomer && (
            <p className="field-hint">
              {qboCustomers.length === 0
                ? "No customers synced from QuickBooks yet."
                : `${qboCustomers.length} customer(s) from QuickBooks.`}{" "}
              Vendor number and address on a later NSA quote/invoice auto-fill from whichever
              customer is picked here.
            </p>
          )}
          {staleCustomerNotice && !isNewCustomer && (
            <div className="banner banner-error">{staleCustomerNotice}</div>
          )}
          {qboCustomersError && <div className="banner banner-error">{qboCustomersError}</div>}
        </div>

        <label className="field">
          <span>Job description</span>
          <input
            type="text"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="e.g. Corporate gifting — Q3 site visit"
          />
        </label>

        <label className="field">
          <span>Event date</span>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
        </label>
      </div>

      <JobSheetLinesGrid
        rows={rows}
        onChange={setRows}
        financials={financials}
        preservePhotoFiles={editingApproved}
        descriptionSuggestions={commonExpenses.map((e) => e.label)}
        companyName={selectedCompany?.name ?? ""}
      />

      {/* The sheet's own footer carries the numbers staff read. This is the
          rest of the cascade — real, but not part of the spreadsheet face, so
          it stays folded away rather than sitting between the grid and the
          save button. */}
      <details className="job-sheet-breakdown">
        <summary>Full breakdown</summary>
        <div className="financial-grid">
          <span>Client subtotal</span>
          <strong>R {financials.clientSubtotal.toFixed(2)}</strong>

          <span>VAT (15%)</span>
          <strong>R {financials.vatAmount.toFixed(2)}</strong>

          <span>Client total (incl. VAT)</span>
          <strong>R {financials.clientTotal.toFixed(2)}</strong>

          <span>Supplier expenses</span>
          <strong>R {financials.expenseTotal.toFixed(2)}</strong>

          {financials.sibanyeRebate > 0 && (
            <>
              <span>Sibanye 2.5%</span>
              <strong>R {financials.sibanyeRebate.toFixed(2)}</strong>
            </>
          )}

          <span>Gross profit</span>
          <strong>R {financials.grossProfit.toFixed(2)}</strong>

          {selectedCompany?.name === "African Nomad" && (
            <>
              <span>NSA fee (10%)</span>
              <strong>R {financials.nsaFee.toFixed(2)}</strong>
            </>
          )}
          {selectedCompany?.name === "Tuscany SA" && (
            <>
              <span>Silent partner fee (10%)</span>
              <strong>R {financials.tuscanyFee.toFixed(2)}</strong>
            </>
          )}

          <span>Net profit</span>
          <strong>R {financials.netProfit.toFixed(2)}</strong>
        </div>
      </details>

      {saveError && (
        <div ref={saveErrorRef} className="banner banner-error">
          {saveError}
        </div>
      )}
      {saveMessage && <div className="banner banner-success" role="status">{saveMessage}</div>}

      <div className="form-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setShowPrintPreview(true)}
        >
          Print job sheet
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setShowQuotePreview(true)}
        >
          View / print quote
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={saving || copying}
          onClick={handleCopy}
        >
          {copying ? "Copying…" : "Copy job sheet"}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={saving || copying}
          onClick={handleSave}
        >
          {saving ? "Saving…" : editingId ? "Save changes" : "Save draft"}
        </button>
      </div>

      {showPrintPreview && (
        <JobSheetInternalDocument
          job={draftJobSheet}
          companyName={selectedCompany?.name ?? ""}
          onClose={() => setShowPrintPreview(false)}
        />
      )}

      {showQuotePreview && (
        <JobSheetDocument
          job={draftJobSheet}
          companyName={selectedCompany?.name ?? ""}
          onClose={() => setShowQuotePreview(false)}
        />
      )}
    </div>
  );
});
