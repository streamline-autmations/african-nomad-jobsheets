import { useEffect, useMemo, useState } from "react";
import { CompanySelect } from "./CompanySelect";
import { CustomerSelect } from "./CustomerSelect";
import { PairedLineItemsTable } from "./PairedLineItemsTable";
import { calculateJobSheetFinancials, withLineTotal } from "../lib/feeCalculations";
import {
  emptyPairedRow,
  linesToPairedRows,
  pairedRowsToLines,
  type PairedRow,
} from "../lib/pairedLineItems";
import {
  fetchCommonExpenses,
  fetchCompanies,
  fetchCustomers,
  fetchJobSheetById,
  saveJobSheetDraft,
} from "../lib/jobSheets";
import type { CommonExpense, Company, Customer } from "../types";
import { errorMessage } from "../lib/errors";
import { SpotBidCheck } from "./SpotBidCheck";

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
  const [jobDescription, setJobDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  // The form works in "paired rows" (client price + supplier cost on one
  // line, matching the real spreadsheet) — derived into the two separate
  // arrays the database/QBD pipeline actually store only at save time.
  const [pairedRows, setPairedRows] = useState<PairedRow[]>([emptyPairedRow()]);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
        setJobDescription(job.jobDescription);
        setEventDate(job.eventDate ?? "");
        setPairedRows(linesToPairedRows(job.clientLines, job.expenseLines));
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

  const { clientLines, expenseLines } = useMemo(
    () => pairedRowsToLines(pairedRows),
    [pairedRows],
  );

  const financials = useMemo(() => {
    return calculateJobSheetFinancials({
      companyName: selectedCompany?.name ?? "",
      customerName: customerNameRaw,
      clientLines: clientLines.map(withLineTotal),
      expenseLines: expenseLines.map(withLineTotal),
    });
  }, [selectedCompany, customerNameRaw, clientLines, expenseLines]);

  function resetForm() {
    setCompanyId("");
    setCustomerId(null);
    setCustomerNameRaw("");
    setIsNewCustomer(false);
    setJobDescription("");
    setEventDate("");
    setPairedRows([emptyPairedRow()]);
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
          Which company is doing the work, who it's for, and what the job is — the description
          becomes a trackable Job in QuickBooks once this sheet is approved and synced.
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

        <label className="field">
          <span>Job description</span>
          <input
            type="text"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="e.g. Corporate gifting — Q3 site visit"
          />
          <p className="field-note">Used as the QuickBooks Job name — keep it short and specific.</p>
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

      <PairedLineItemsTable
        rows={pairedRows}
        onChange={setPairedRows}
        descriptionSuggestions={commonExpenses.map((e) => e.label)}
        companyName={selectedCompany?.name ?? ""}
        customerName={customerNameRaw}
      />

      <div className="financial-summary">
        <h3>Summary</h3>
        <p className="section-description">
          Calculates automatically as you fill in lines above — nothing here needs typing.
        </p>
        <div className="financial-summary-columns">
          <div className="financial-grid">
            <span>Client subtotal</span>
            <strong>R {financials.clientSubtotal.toFixed(2)}</strong>

            {financials.sibanyeDiscount > 0 && (
              <>
                <span>Sibanye discount (2.5%)</span>
                <strong>- R {financials.sibanyeDiscount.toFixed(2)}</strong>
              </>
            )}

            <span>VAT (15%)</span>
            <strong>R {financials.vatAmount.toFixed(2)}</strong>

            <span>Client total (incl. VAT)</span>
            <strong>R {financials.clientTotal.toFixed(2)}</strong>
          </div>

          <div className="financial-grid financial-grid-fees">
            <span>Expense total</span>
            <strong>R {financials.expenseTotal.toFixed(2)}</strong>

            <span>Gross profit</span>
            <strong>R {financials.grossProfit.toFixed(2)}</strong>

            <span>Gross margin</span>
            <strong className={financials.belowMarginTarget ? "margin-flag" : ""}>
              {financials.profitMarginPct.toFixed(1)}%
              {financials.belowMarginTarget && " ⚠ below 20% target"}
            </strong>

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

            <span>Net margin</span>
            <strong>{financials.netMarginPct.toFixed(1)}%</strong>
          </div>
        </div>
      </div>

      <SpotBidCheck expenseTotal={financials.expenseTotal} />

      {saveError && <div className="banner banner-error">{saveError}</div>}
      {saveMessage && <div className="banner banner-success">{saveMessage}</div>}

      <button
        type="button"
        className="btn-primary"
        disabled={saving}
        onClick={handleSave}
      >
        {saving ? "Saving…" : editingId ? "Save changes" : "Save draft"}
      </button>
    </div>
  );
}
