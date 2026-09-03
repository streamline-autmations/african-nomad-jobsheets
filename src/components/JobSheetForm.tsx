import { useEffect, useMemo, useState } from "react";
import { CompanySelect } from "./CompanySelect";
import { CustomerSelect } from "./CustomerSelect";
import { JobSheetLinesGrid } from "./JobSheetLinesGrid";
import { JobSheetInternalDocument } from "./JobSheetInternalDocument";
import { JobSheetDocument } from "./JobSheetDocument";
import { calculateJobSheetFinancials, withLineTotal } from "../lib/feeCalculations";
import { linesToSheetRows, sheetRowsToLines, type SheetRow } from "../lib/jobSheetRows";
import {
  fetchCommonExpenses,
  fetchCompanies,
  fetchCustomers,
  fetchJobSheetById,
  saveJobSheetDraft,
} from "../lib/jobSheets";
import {
  fetchNsaQboCustomers,
  fetchNsaQboCustomersFresh,
  nsaQboCustomerLabel,
  syncNsaQboCustomers,
  type NsaQboCustomer,
} from "../lib/nsaQboCustomers";
import type { CommonExpense, Company, Customer, JobSheet } from "../types";
import { errorMessage } from "../lib/errors";

interface JobSheetFormProps {
  /** When set, loads that existing draft for editing instead of starting blank
   * (e.g. an AN Job Sheet created from an NSA Quote, which has no expenses yet). */
  editJobSheetId?: string | null;
  /** Called after a successful save while editing — lets the caller navigate
   * back (e.g. to Approvals) instead of leaving a stale editing session open. */
  onEditSaved?: () => void;
}

export function JobSheetForm({ editJobSheetId, onEditSaved }: JobSheetFormProps) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [commonExpenses, setCommonExpenses] = useState<CommonExpense[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerNameRaw, setCustomerNameRaw] = useState("");
  const [isNewCustomer, setIsNewCustomer] = useState(false);

  // Real customers mirrored from NSA's QuickBooks Online company (see
  // api/qbo/sync-nsa-customers.ts). Separate from the CustomerSelect/
  // customers table above (the old, never-actually-synced QBD mirror) —
  // linking a job sheet to one of these is what lets the eventual NSA quote/
  // invoice hand-off (ApprovalView) auto-fill vendor number and address
  // instead of retyping them.
  const [qboCustomers, setQboCustomers] = useState<NsaQboCustomer[]>([]);
  const [qboCustomersError, setQboCustomersError] = useState<string | null>(null);
  const [syncingQboCustomers, setSyncingQboCustomers] = useState(false);
  const [selectedQboCustomerId, setSelectedQboCustomerId] = useState<string | null>(null);

  const [jobDescription, setJobDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  // The form works in sheet rows — the CLIENT and COMPANY EXPENSES columns
  // side by side, as the real spreadsheet lays them out. Split back into the
  // two arrays the database and the QBD pipeline actually store only at save
  // time; see lib/jobSheetRows.ts.
  const [rows, setRows] = useState<SheetRow[]>(() => linesToSheetRows([], []));

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [showQuotePreview, setShowQuotePreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCompanies(), fetchCustomers(), fetchCommonExpenses()])
      .then(([companiesData, customersData, expensesData]) => {
        if (cancelled) return;
        setCompanies(companiesData);
        setCustomers(customersData);
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

  // Auto-syncs if the mirror is stale/empty (see fetchNsaQboCustomersFresh)
  // so this list stays current without anyone having to remember to click
  // "Sync from QuickBooks" first.
  useEffect(() => {
    let cancelled = false;
    fetchNsaQboCustomersFresh()
      .then((data) => {
        if (cancelled) return;
        setQboCustomers(data);
        setQboCustomersError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setQboCustomersError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function loadQboCustomers() {
    fetchNsaQboCustomers()
      .then((data) => {
        setQboCustomers(data);
        setQboCustomersError(null);
      })
      .catch((err: unknown) => setQboCustomersError(errorMessage(err)));
  }

  async function handleSyncQboCustomers() {
    setQboCustomersError(null);
    setSyncingQboCustomers(true);
    try {
      await syncNsaQboCustomers();
      loadQboCustomers();
    } catch (err) {
      setQboCustomersError(errorMessage(err));
    } finally {
      setSyncingQboCustomers(false);
    }
  }

  useEffect(() => {
    if (!editJobSheetId) return;
    let cancelled = false;
    setLoadingExisting(true);
    fetchJobSheetById(editJobSheetId)
      .then((job) => {
        if (cancelled) return;
        setEditingId(job.id);
        setCompanyId(job.companyId);
        setCustomerId(job.customerId);
        setCustomerNameRaw(job.customerNameRaw);
        setIsNewCustomer(job.customerId === null);
        setSelectedQboCustomerId(job.qboCustomerId);
        setJobDescription(job.jobDescription);
        setEventDate(job.eventDate ?? "");
        setRows(linesToSheetRows(job.clientLines, job.expenseLines));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editJobSheetId]);

  const selectedCompany = companies.find((c) => c.id === companyId);

  const { clientLines, expenseLines } = useMemo(() => sheetRowsToLines(rows), [rows]);

  const financials = useMemo(() => {
    return calculateJobSheetFinancials({
      companyName: selectedCompany?.name ?? "",
      customerName: customerNameRaw,
      clientLines: clientLines.map(withLineTotal),
      expenseLines: expenseLines.map(withLineTotal),
    });
  }, [selectedCompany, customerNameRaw, clientLines, expenseLines]);

  // A print/download preview needs a full JobSheet shape, but this form
  // works from loose draft state that may not be saved yet — so this fills
  // in the fields a real saved row would have with drafty placeholders
  // rather than requiring a save first just to see what it'll look like.
  const draftJobSheet: JobSheet = useMemo(
    () => ({
      id: editingId ?? "draft",
      companyId,
      customerId: isNewCustomer ? null : customerId,
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
      ...financials,
    }),
    [
      editingId,
      companyId,
      isNewCustomer,
      customerId,
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
    setCustomerId(null);
    setCustomerNameRaw("");
    setIsNewCustomer(false);
    setSelectedQboCustomerId(null);
    setJobDescription("");
    setEventDate("");
    setRows(linesToSheetRows([], []));
  }

  async function handleSave() {
    setSaveError(null);
    setSaveMessage(null);

    if (!companyId) {
      setSaveError("Select a company before saving.");
      return;
    }
    if (!isNewCustomer && !customerId) {
      setSaveError("Select a customer, or tick \"this customer doesn't exist yet\".");
      return;
    }
    if (isNewCustomer && !customerNameRaw.trim()) {
      setSaveError("Type the new customer's name.");
      return;
    }

    setSaving(true);
    try {
      await saveJobSheetDraft({
        id: editingId,
        companyId,
        companyName: selectedCompany?.name ?? "",
        customerId: isNewCustomer ? null : customerId,
        customerNameRaw,
        qboCustomerId: selectedQboCustomerId,
        jobDescription,
        eventDate: eventDate || null,
        clientLines: clientLines.map(withLineTotal),
        expenseLines: expenseLines.map(withLineTotal),
      });
      if (editingId) {
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

  if (loadError) {
    return (
      <div className="banner banner-error">
        Couldn&apos;t load reference data: {loadError}
      </div>
    );
  }

  if (loadingExisting) {
    return <p>Loading job sheet…</p>;
  }

  return (
    <div className="job-sheet-form">
      {editingId && (
        <div className="banner">Editing an existing draft — changes replace what&apos;s there.</div>
      )}

      <div className="form-section-heading">
        <h3>Job details</h3>
        <p className="section-description">
          The job description becomes the Job name in QuickBooks.
        </p>
      </div>

      <div className="form-grid">
        <CompanySelect companies={companies} value={companyId} onChange={setCompanyId} />

        <CustomerSelect
          customers={customers}
          customerId={customerId}
          customerNameRaw={customerNameRaw}
          isNewCustomer={isNewCustomer}
          onSelectExisting={(id, name) => {
            setCustomerId(id);
            setCustomerNameRaw(name);
          }}
          onToggleNew={(isNew) => {
            setIsNewCustomer(isNew);
            setCustomerId(null);
            setCustomerNameRaw("");
          }}
          onNewNameChange={setCustomerNameRaw}
        />

        <div className="field">
          <span>Link to a real QuickBooks customer (optional)</span>
          <select
            value={selectedQboCustomerId ?? ""}
            onChange={(e) => setSelectedQboCustomerId(e.target.value || null)}
          >
            <option value="">Not linked</option>
            {qboCustomers.map((customer) => (
              <option key={customer.qboCustomerId} value={customer.qboCustomerId}>
                {nsaQboCustomerLabel(customer, qboCustomers)}
              </option>
            ))}
          </select>
          <p className="field-hint">
            {qboCustomers.length === 0
              ? "No customers synced yet."
              : `${qboCustomers.length} customer(s) synced.`}{" "}
            Linking one lets an NSA quote or invoice made from this job sheet
            auto-fill vendor number and address instead of retyping them.{" "}
            <button
              type="button"
              className="btn-secondary"
              disabled={syncingQboCustomers}
              onClick={handleSyncQboCustomers}
            >
              {syncingQboCustomers ? "Syncing…" : "Sync from QuickBooks"}
            </button>
          </p>
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

      {saveError && <div className="banner banner-error">{saveError}</div>}
      {saveMessage && <div className="banner banner-success">{saveMessage}</div>}

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
          className="btn-primary"
          disabled={saving}
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
}
