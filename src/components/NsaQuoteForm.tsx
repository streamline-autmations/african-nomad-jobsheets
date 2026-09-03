import { useEffect, useMemo, useState } from "react";
import { LineItemsTable } from "./LineItemsTable";
import { withLineTotal } from "../lib/feeCalculations";
import {
  calculateNsaQuoteTotals,
  createNsaInvoiceDirect,
  saveNsaQuoteDraft,
} from "../lib/nsaQuotes";
import {
  fetchNsaQboCustomers,
  fetchNsaQboCustomersFresh,
  nsaQboCustomerLabel,
  syncNsaQboCustomers,
  type NsaQboCustomer,
} from "../lib/nsaQboCustomers";
import type { LineItemInput } from "../types";
import { errorMessage } from "../lib/errors";

function emptyLine(): LineItemInput {
  return { id: crypto.randomUUID(), description: "", qty: 1, unitCost: 0 };
}

type DocKind = "quote" | "invoice";

interface NsaQuoteFormProps {
  onSaved: () => void;
}

// Handles both creation paths: a formal Quote (draft, sent to the mine for
// acceptance before anything else happens), or a direct Invoice for jobs
// that never had a formal quote (e.g. a small ad-hoc order) — per
// Christiaan's 2026-07-20 request to be able to make either from here.
export function NsaQuoteForm({ onSaved }: NsaQuoteFormProps) {
  const [docKind, setDocKind] = useState<DocKind>("quote");
  const [quoteNumber, setQuoteNumber] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [vendorNumber, setVendorNumber] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [lines, setLines] = useState<LineItemInput[]>([emptyLine()]);

  // Real customers mirrored from NSA's QuickBooks Online company (see
  // api/qbo/sync-nsa-customers.ts). Manual entry stays the default since this
  // list is empty until a real QBO connection exists and has been synced at
  // least once.
  const [qboCustomers, setQboCustomers] = useState<NsaQboCustomer[]>([]);
  const [qboCustomersError, setQboCustomersError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [isManualClient, setIsManualClient] = useState(true);
  const [selectedQboCustomerId, setSelectedQboCustomerId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function loadQboCustomers() {
    fetchNsaQboCustomers()
      .then((data) => {
        setQboCustomers(data);
        setQboCustomersError(null);
      })
      .catch((err: unknown) => setQboCustomersError(errorMessage(err)));
  }

  // First load auto-syncs if the mirror is stale/empty (see
  // fetchNsaQboCustomersFresh) so this list stays current without anyone
  // having to remember to click "Sync from QuickBooks" — that button still
  // exists below for an on-demand refresh.
  useEffect(() => {
    fetchNsaQboCustomersFresh()
      .then((data) => {
        setQboCustomers(data);
        setQboCustomersError(null);
      })
      .catch((err: unknown) => setQboCustomersError(errorMessage(err)));
  }, []);

  async function handleSync() {
    setQboCustomersError(null);
    setSyncing(true);
    try {
      await syncNsaQboCustomers();
      loadQboCustomers();
    } catch (err) {
      setQboCustomersError(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  function handleSelectQboCustomer(qboCustomerId: string) {
    const customer = qboCustomers.find((c) => c.qboCustomerId === qboCustomerId);
    if (!customer) return;
    setSelectedQboCustomerId(customer.qboCustomerId);
    setClientName(nsaQboCustomerLabel(customer, qboCustomers));
    setClientAddress(customer.billAddress);
    if (customer.vendorNumber) setVendorNumber(customer.vendorNumber);
  }

  const totals = useMemo(
    () => calculateNsaQuoteTotals(lines.map(withLineTotal)),
    [lines],
  );

  function resetForm() {
    setQuoteNumber("");
    setInvoiceNumber("");
    setVendorNumber("");
    setPoNumber("");
    setClientName("");
    setClientAddress("");
    setJobDescription("");
    setEventDate("");
    setLines([emptyLine()]);
    setSelectedQboCustomerId(null);
  }

  async function handleSave() {
    setSaveError(null);
    setSaveMessage(null);

    if (docKind === "quote" && !quoteNumber.trim()) {
      setSaveError("Enter the quote number NSA's own system would use.");
      return;
    }
    if (docKind === "invoice" && !invoiceNumber.trim()) {
      setSaveError("Enter the invoice number NSA's own system would use.");
      return;
    }
    if (!clientName.trim()) {
      setSaveError("Enter the client name.");
      return;
    }

    setSaving(true);
    try {
      if (docKind === "quote") {
        await saveNsaQuoteDraft({
          quoteNumber: quoteNumber.trim(),
          vendorNumber: vendorNumber.trim(),
          poNumber: poNumber.trim(),
          clientName: clientName.trim(),
          clientAddress: clientAddress.trim(),
          qboCustomerId: selectedQboCustomerId,
          jobDescription,
          eventDate: eventDate || null,
          lines: lines.map(withLineTotal),
        });
        setSaveMessage("Draft saved.");
      } else {
        await createNsaInvoiceDirect({
          nsaInvoiceNumber: invoiceNumber.trim(),
          vendorNumber: vendorNumber.trim(),
          poNumber: poNumber.trim(),
          clientName: clientName.trim(),
          clientAddress: clientAddress.trim(),
          qboCustomerId: selectedQboCustomerId,
          jobDescription,
          eventDate: eventDate || null,
          lines: lines.map(withLineTotal),
        });
        setSaveMessage("Invoice created.");
      }
      resetForm();
      onSaved();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="job-sheet-form">
      <div className="nsa-dockind-toggle">
        <label className="checkbox-inline">
          <input
            type="radio"
            checked={docKind === "quote"}
            onChange={() => setDocKind("quote")}
          />
          Quote
        </label>
        <label className="checkbox-inline">
          <input
            type="radio"
            checked={docKind === "invoice"}
            onChange={() => setDocKind("invoice")}
          />
          Invoice (no quote first)
        </label>
      </div>

      <div className="form-grid">
        {docKind === "quote" ? (
          <label className="field">
            <span>Quote number</span>
            <input
              type="text"
              value={quoteNumber}
              onChange={(e) => setQuoteNumber(e.target.value)}
              placeholder="e.g. 1292 — match NSA's own sequence"
            />
          </label>
        ) : (
          <label className="field">
            <span>Invoice number</span>
            <input
              type="text"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="e.g. NSA06385 — match NSA's own sequence"
            />
          </label>
        )}

        <label className="field">
          <span>NSA's vendor number with this client</span>
          <input
            type="text"
            value={vendorNumber}
            onChange={(e) => setVendorNumber(e.target.value)}
            placeholder="e.g. 26421"
          />
        </label>

        <label className="field">
          <span>Purchase Order number</span>
          <input
            type="text"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="e.g. N/A"
          />
        </label>

        <div className="field">
          <span>Bill to / Ship to</span>

          {!isManualClient && (
            <select
              value={selectedQboCustomerId ?? ""}
              onChange={(e) => handleSelectQboCustomer(e.target.value)}
            >
              <option value="" disabled>
                Select a QuickBooks customer…
              </option>
              {qboCustomers.map((customer) => (
                <option key={customer.qboCustomerId} value={customer.qboCustomerId}>
                  {nsaQboCustomerLabel(customer, qboCustomers)}
                </option>
              ))}
            </select>
          )}

          {isManualClient && (
            <>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Harmony Kalgold"
              />
              <input
                type="text"
                value={clientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
                placeholder="e.g. Kalgold - Stores, Mafikeng, NW 1760"
                style={{ marginTop: "0.5rem" }}
              />
            </>
          )}

          <label className="checkbox-inline" style={{ marginTop: "0.5rem" }}>
            <input
              type="checkbox"
              checked={!isManualClient}
              onChange={(e) => {
                setIsManualClient(!e.target.checked);
                if (!e.target.checked) setSelectedQboCustomerId(null);
              }}
            />
            Pick from QuickBooks customers instead of typing
          </label>

          {!isManualClient && (
            <p className="field-hint">
              {qboCustomers.length === 0
                ? "No customers synced yet."
                : `${qboCustomers.length} customer(s) synced${qboCustomers[0]?.lastSyncedAt ? ` — last synced ${new Date(qboCustomers[0].lastSyncedAt!).toLocaleString()}` : ""}.`}{" "}
              <button type="button" className="btn-secondary" disabled={syncing} onClick={handleSync}>
                {syncing ? "Syncing…" : "Sync from QuickBooks"}
              </button>
            </p>
          )}

          {qboCustomersError && <div className="banner banner-error">{qboCustomersError}</div>}
        </div>

        <label className="field">
          <span>Job description</span>
          <input
            type="text"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Event date</span>
          <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </label>
      </div>

      <LineItemsTable title="Line items" lines={lines} onChange={setLines} />

      <div className="financial-summary">
        <h3>Summary</h3>
        <div className="financial-grid">
          <span>Subtotal</span>
          <strong>R {totals.subtotal.toFixed(2)}</strong>
          <span>VAT (15%)</span>
          <strong>R {totals.vatAmount.toFixed(2)}</strong>
          <span>Total</span>
          <strong>R {totals.total.toFixed(2)}</strong>
        </div>
      </div>

      {saveError && <div className="banner banner-error">{saveError}</div>}
      {saveMessage && <div className="banner banner-success">{saveMessage}</div>}

      <button type="button" className="btn-primary" disabled={saving} onClick={handleSave}>
        {saving ? "Saving…" : docKind === "quote" ? "Save draft" : "Create invoice"}
      </button>
    </div>
  );
}
