import { useEffect, useMemo, useState } from "react";
import { CompanySelect } from "./CompanySelect";
import { CustomerSelect } from "./CustomerSelect";
import { LineItemsTable } from "./LineItemsTable";
import { calculateJobSheetFinancials, withLineTotal } from "../lib/feeCalculations";
import {
  fetchCommonExpenses,
  fetchCompanies,
  fetchCustomers,
  saveJobSheetDraft,
} from "../lib/jobSheets";
import type { CommonExpense, Company, Customer, LineItemInput } from "../types";

function emptyLine(): LineItemInput {
  return { id: crypto.randomUUID(), description: "", qty: 1, unitCost: 0 };
}

export function JobSheetForm() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [commonExpenses, setCommonExpenses] = useState<CommonExpense[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerNameRaw, setCustomerNameRaw] = useState("");
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [clientLines, setClientLines] = useState<LineItemInput[]>([emptyLine()]);
  const [expenseLines, setExpenseLines] = useState<LineItemInput[]>([emptyLine()]);

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
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCompany = companies.find((c) => c.id === companyId);

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
    setClientLines([emptyLine()]);
    setExpenseLines([emptyLine()]);
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
        companyId,
        companyName: selectedCompany?.name ?? "",
        customerId: isNewCustomer ? null : customerId,
        customerNameRaw,
        jobDescription,
        eventDate: eventDate || null,
        clientLines: clientLines.map(withLineTotal),
        expenseLines: expenseLines.map(withLineTotal),
      });
      setSaveMessage("Draft saved.");
      resetForm();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
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

  return (
    <div className="job-sheet-form">
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

      <LineItemsTable
        title="Client line items"
        lines={clientLines}
        onChange={setClientLines}
      />

      <LineItemsTable
        title="Expenses"
        lines={expenseLines}
        onChange={setExpenseLines}
        descriptionSuggestions={commonExpenses.map((e) => e.label)}
      />

      <div className="financial-summary">
        <h3>Summary</h3>
        <div className="financial-grid">
          <span>Client subtotal</span>
          <strong>R {financials.clientSubtotal.toFixed(2)}</strong>

          <span>VAT (15%)</span>
          <strong>R {financials.vatAmount.toFixed(2)}</strong>

          <span>Client total (incl. VAT)</span>
          <strong>R {financials.clientTotal.toFixed(2)}</strong>

          <span>Expense total</span>
          <strong>R {financials.expenseTotal.toFixed(2)}</strong>

          <span>Gross profit</span>
          <strong>R {financials.grossProfit.toFixed(2)}</strong>

          <span>Gross margin</span>
          <strong className={financials.belowMarginTarget ? "margin-flag" : ""}>
            {financials.profitMarginPct.toFixed(1)}%
            {financials.belowMarginTarget && " ⚠ below 20% target"}
          </strong>
        </div>

        <div className="financial-grid financial-grid-fees">
          {selectedCompany?.name === "African Nomad" && (
            <>
              <span>NSA fee (10%)</span>
              <strong>R {financials.nsaFee.toFixed(2)}</strong>
              {financials.sibanyeFee > 0 && (
                <>
                  <span>Sibanye extra fee (2.5%)</span>
                  <strong>R {financials.sibanyeFee.toFixed(2)}</strong>
                </>
              )}
            </>
          )}
          {selectedCompany?.name === "Tuscany SA" && (
            <>
              <span>Silent partner fee (10%)</span>
              <strong>R {financials.tuscanyFee.toFixed(2)}</strong>
            </>
          )}

          <span>Total fees</span>
          <strong>R {financials.totalFees.toFixed(2)}</strong>

          <span>Net profit</span>
          <strong>R {financials.netProfit.toFixed(2)}</strong>

          <span>Net margin</span>
          <strong>{financials.netMarginPct.toFixed(1)}%</strong>
        </div>
      </div>

      {saveError && <div className="banner banner-error">{saveError}</div>}
      {saveMessage && <div className="banner banner-success">{saveMessage}</div>}

      <button
        type="button"
        className="btn-primary"
        disabled={saving}
        onClick={handleSave}
      >
        {saving ? "Saving…" : "Save draft"}
      </button>
    </div>
  );
}
