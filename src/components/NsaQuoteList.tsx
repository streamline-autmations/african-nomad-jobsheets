import { useEffect, useState } from "react";
import {
  fetchNsaQuotes,
  markNsaQuoteAccepted,
  markNsaQuoteInvoiced,
  markNsaQuoteSent,
} from "../lib/nsaQuotes";
import { convertNsaQuoteToJobSheet } from "../lib/nsaToJobSheet";
import { NsaQuoteDocument } from "./NsaQuoteDocument";
import type { NsaQuote } from "../nsaTypes";

export function NsaQuoteList() {
  const [quotes, setQuotes] = useState<NsaQuote[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<"quote" | "invoice" | null>(null);
  const [invoiceNumberInput, setInvoiceNumberInput] = useState("");

  function load() {
    setLoading(true);
    fetchNsaQuotes()
      .then((data) => {
        setQuotes(data);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const selected = quotes.find((q) => q.id === selectedId) ?? null;

  async function handleMarkSent(quote: NsaQuote) {
    setActionError(null);
    setBusy(true);
    try {
      await markNsaQuoteSent(quote.id);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkAccepted(quote: NsaQuote) {
    setActionError(null);
    const confirmed = window.confirm(
      `Mark quote ${quote.quoteNumber} as accepted by ${quote.clientName}?`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await markNsaQuoteAccepted(quote.id);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkInvoiced(quote: NsaQuote) {
    setActionError(null);
    if (!invoiceNumberInput.trim()) {
      setActionError("Enter the NSA invoice number before marking this invoiced.");
      return;
    }
    setBusy(true);
    try {
      await markNsaQuoteInvoiced(quote.id, invoiceNumberInput.trim());
      setInvoiceNumberInput("");
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateJobSheet(quote: NsaQuote) {
    setActionError(null);
    setActionMessage(null);
    setBusy(true);
    try {
      await convertNsaQuoteToJobSheet(quote);
      setActionMessage(
        "AN Job Sheet draft created — go to the New Job Sheet / Approvals tabs to add expenses and approve it.",
      );
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePushToQbo(quote: NsaQuote) {
    setActionError(null);
    setActionMessage(null);
    setBusy(true);
    try {
      const res = await fetch("/api/qbo/push-nsa-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Push to QuickBooks failed.");
      setActionMessage(
        `Sent to QuickBooks Online as ${quote.status === "invoiced" ? "Invoice" : "Estimate"} ${body.qboDocNumber} — check your connected QBO company.`,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p>Loading NSA quotes…</p>;
  if (loadError) return <div className="banner banner-error">{loadError}</div>;
  if (quotes.length === 0) return <p>No NSA quotes yet — create one first.</p>;

  const canCreateJobSheet =
    selected &&
    !selected.anJobSheetId &&
    (selected.status === "accepted" || selected.status === "invoiced");

  return (
    <div className="approval-view">
      <div className="approval-list">
        {quotes.map((quote) => (
          <button
            key={quote.id}
            type="button"
            className={`approval-list-item ${quote.id === selectedId ? "selected" : ""}`}
            onClick={() => setSelectedId(quote.id)}
          >
            <strong>
              #{quote.quoteNumber} — {quote.clientName || "Unnamed client"}
            </strong>
            <span>{quote.jobDescription || "No description"}</span>
            <span className="nsa-status-badge">{quote.status}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="approval-detail">
          <h3>
            #{selected.quoteNumber} — {selected.clientName}
          </h3>
          <p>{selected.jobDescription}</p>

          <div className="financial-grid">
            <span>Subtotal</span>
            <strong>R {selected.subtotal.toFixed(2)}</strong>
            <span>VAT</span>
            <strong>R {selected.vatAmount.toFixed(2)}</strong>
            <span>Total</span>
            <strong>R {selected.total.toFixed(2)}</strong>
            <span>Status</span>
            <strong>{selected.status}</strong>
          </div>

          {actionError && <div className="banner banner-error">{actionError}</div>}
          {actionMessage && <div className="banner banner-success">{actionMessage}</div>}

          <div className="nsa-action-row">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setViewingDoc("quote")}
            >
              View / Print Quote
            </button>

            {selected.status === "draft" && (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => handleMarkSent(selected)}
              >
                Mark as Sent
              </button>
            )}

            {selected.status === "sent" && (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => handleMarkAccepted(selected)}
              >
                Mark as Accepted
              </button>
            )}

            {selected.status === "accepted" && (
              <>
                <input
                  type="text"
                  placeholder="NSA invoice number"
                  value={invoiceNumberInput}
                  onChange={(e) => setInvoiceNumberInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => handleMarkInvoiced(selected)}
                >
                  Flip to Invoice
                </button>
              </>
            )}

            {selected.status === "invoiced" && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setViewingDoc("invoice")}
              >
                View / Print Invoice
              </button>
            )}

            {canCreateJobSheet && (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => handleCreateJobSheet(selected)}
              >
                Create AN Job Sheet
              </button>
            )}

            {selected.status !== "draft" && (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => handlePushToQbo(selected)}
              >
                Push to QuickBooks Online
              </button>
            )}
          </div>

          {selected.anJobSheetId && (
            <p className="field-hint">
              AN Job Sheet already created for this — go to Approvals to review it.
            </p>
          )}
        </div>
      )}

      {viewingDoc && selected && (
        <NsaQuoteDocument
          quote={selected}
          docType={viewingDoc}
          onClose={() => setViewingDoc(null)}
        />
      )}
    </div>
  );
}
