import { useEffect, useState } from "react";
import { approveJobSheet, fetchDraftJobSheets } from "../lib/jobSheets";
import { fetchLatestNsaQuoteForClient } from "../lib/nsaQuotes";
import { convertJobSheetToNsaQuote } from "../lib/jobSheetToNsaQuote";
import type { JobSheet } from "../types";
import { errorMessage } from "../lib/errors";

interface ApprovalViewProps {
  onEditJobSheet: (id: string) => void;
}

const EMPTY_QUOTE_FIELDS = {
  quoteNumber: "",
  vendorNumber: "",
  poNumber: "",
  clientAddress: "",
};

export function ApprovalView({ onEditJobSheet }: ApprovalViewProps) {
  const [drafts, setDrafts] = useState<JobSheet[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // NSA quote hand-off state.
  const [quoteFormOpen, setQuoteFormOpen] = useState(false);
  const [quoteFields, setQuoteFields] = useState(EMPTY_QUOTE_FIELDS);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteMessage, setQuoteMessage] = useState<string | null>(null);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchDraftJobSheets()
      .then((data) => {
        setDrafts(data);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const selected = drafts.find((d) => d.id === selectedId) ?? null;

  // Selecting a different job sheet abandons any half-filled quote form —
  // carrying one sheet's quote number over to another would be a nasty way to
  // burn one of NSA's numbers on the wrong job.
  useEffect(() => {
    setQuoteFormOpen(false);
    setQuoteFields(EMPTY_QUOTE_FIELDS);
    setQuoteError(null);
    setQuoteMessage(null);
    setPrefillNote(null);
  }, [selectedId]);

  // Vendor number and address belong to the NSA-to-mine relationship, not to
  // the job, so they're the same on every quote to that mine. Pull them from
  // the last one rather than making him retype them.
  async function openQuoteForm(jobSheet: JobSheet) {
    setQuoteFormOpen(true);
    setQuoteError(null);
    setQuoteMessage(null);
    try {
      const previous = await fetchLatestNsaQuoteForClient(jobSheet.customerNameRaw);
      if (previous) {
        setQuoteFields({
          ...EMPTY_QUOTE_FIELDS,
          vendorNumber: previous.vendorNumber,
          clientAddress: previous.clientAddress,
        });
        setPrefillNote(
          `Vendor number and address carried over from quote ${previous.quoteNumber || "(unnumbered)"} for this client.`,
        );
      } else {
        setPrefillNote(null);
      }
    } catch (err) {
      // Prefill is a convenience, never a blocker — the fields are all
      // editable anyway, so a lookup failure just means typing them.
      setPrefillNote(`Couldn't load previous quote details: ${errorMessage(err)}`);
    }
  }

  async function handleCreateNsaQuote(jobSheet: JobSheet) {
    setQuoteError(null);
    setQuoteMessage(null);
    setQuoteBusy(true);
    try {
      const quote = await convertJobSheetToNsaQuote(jobSheet, quoteFields);
      setQuoteMessage(
        `NSA quote ${quote.quoteNumber || "(unnumbered)"} created as a draft — open the NSA Quotes tab to print it and send it to the mine.`,
      );
      setQuoteFormOpen(false);
      setQuoteFields(EMPTY_QUOTE_FIELDS);
      load();
    } catch (err) {
      setQuoteError(errorMessage(err));
    } finally {
      setQuoteBusy(false);
    }
  }

  async function handleApprove(jobSheet: JobSheet) {
    setApproveError(null);
    const confirmed = window.confirm(
      `Approve this job sheet for ${jobSheet.customerNameRaw || "this customer"}? ` +
        "This will queue it for creation in QuickBooks and cannot be undone from here.",
    );
    if (!confirmed) return;

    setApproving(true);
    try {
      await approveJobSheet(jobSheet.id);
      setSelectedId(null);
      load();
    } catch (err) {
      setApproveError(errorMessage(err));
    } finally {
      setApproving(false);
    }
  }

  if (loading) return <p>Loading drafts…</p>;
  if (loadError) return <div className="banner banner-error">{loadError}</div>;
  if (drafts.length === 0) return <p>No drafts waiting for approval.</p>;

  return (
    <div className="approval-view">
      <div className="approval-list">
        {drafts.map((sheet) => (
          <button
            key={sheet.id}
            type="button"
            className={`approval-list-item ${sheet.id === selectedId ? "selected" : ""}`}
            onClick={() => setSelectedId(sheet.id)}
          >
            <strong>{sheet.customerNameRaw || "Unnamed customer"}</strong>
            <span>{sheet.jobDescription || "No description"}</span>
            <span className={sheet.belowMarginTarget ? "margin-flag" : ""}>
              Gross margin {sheet.profitMarginPct.toFixed(1)}%
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="approval-detail">
          <h3>{selected.customerNameRaw || "Unnamed customer"}</h3>
          <p>{selected.jobDescription}</p>
          {selected.eventDate && <p>Event date: {selected.eventDate}</p>}

          <div className="financial-grid">
            {selected.sibanyeDiscount > 0 && (
              <>
                <span>Sibanye discount (2.5%)</span>
                <strong>- R {selected.sibanyeDiscount.toFixed(2)}</strong>
              </>
            )}
            <span>Client total (incl. VAT)</span>
            <strong>R {selected.clientTotal.toFixed(2)}</strong>
            <span>Expense total</span>
            <strong>R {selected.expenseTotal.toFixed(2)}</strong>
            <span>Gross profit</span>
            <strong>R {selected.grossProfit.toFixed(2)}</strong>
            <span>Gross margin</span>
            <strong className={selected.belowMarginTarget ? "margin-flag" : ""}>
              {selected.profitMarginPct.toFixed(1)}%
              {selected.belowMarginTarget && " ⚠ below 20% target"}
            </strong>
            <span>Total fees (NSA/Tuscany)</span>
            <strong>R {selected.totalFees.toFixed(2)}</strong>
            <span>Net profit</span>
            <strong>R {selected.netProfit.toFixed(2)}</strong>
          </div>

          {!selected.customerId && (
            <p className="field-hint">
              This job sheet references a new customer ("{selected.customerNameRaw}
              ") — approving it will also queue a create_customer request.
            </p>
          )}

          {approveError && <div className="banner banner-error">{approveError}</div>}
          {quoteError && <div className="banner banner-error">{quoteError}</div>}
          {quoteMessage && <div className="banner banner-success">{quoteMessage}</div>}

          <div className="nsa-handoff">
            {selected.nsaQuoteId ? (
              <p className="field-hint">
                NSA quote already created for this job sheet — find it in the NSA Quotes tab.
              </p>
            ) : quoteFormOpen ? (
              <>
                <h4>Create the NSA quote for the mine</h4>
                <p className="section-description">
                  Copies the {selected.clientLines.length} client line
                  {selected.clientLines.length === 1 ? "" : "s"} onto an NSA-branded quote.
                  Supplier costs never cross over — the mine only ever sees NSA.
                </p>
                {prefillNote && <p className="field-hint">{prefillNote}</p>}

                <div className="nsa-handoff-fields">
                  <label className="field">
                    <span>Quote number</span>
                    <input
                      type="text"
                      value={quoteFields.quoteNumber}
                      placeholder="e.g. 1291"
                      onChange={(e) =>
                        setQuoteFields((f) => ({ ...f, quoteNumber: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Vendor number</span>
                    <input
                      type="text"
                      value={quoteFields.vendorNumber}
                      placeholder="NSA's vendor no. with this mine"
                      onChange={(e) =>
                        setQuoteFields((f) => ({ ...f, vendorNumber: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>PO number (optional)</span>
                    <input
                      type="text"
                      value={quoteFields.poNumber}
                      placeholder="Blank shows N/A"
                      onChange={(e) => setQuoteFields((f) => ({ ...f, poNumber: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>Client address</span>
                    <input
                      type="text"
                      value={quoteFields.clientAddress}
                      placeholder="For the Bill-to block"
                      onChange={(e) =>
                        setQuoteFields((f) => ({ ...f, clientAddress: e.target.value }))
                      }
                    />
                  </label>
                </div>

                <p className="field-hint">
                  Quote and vendor numbers are free text on purpose — NSA's own system assigns
                  them, and we must not collide with her sequence.
                </p>

                <div className="line-items-header">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={quoteBusy}
                    onClick={() => setQuoteFormOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={quoteBusy || !quoteFields.quoteNumber.trim()}
                    onClick={() => handleCreateNsaQuote(selected)}
                  >
                    {quoteBusy ? "Creating…" : "Create NSA quote"}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                disabled={approving || selected.clientLines.length === 0}
                title={
                  selected.clientLines.length === 0
                    ? "Add client lines first — there's nothing to quote yet."
                    : undefined
                }
                onClick={() => openQuoteForm(selected)}
              >
                Create NSA quote for the mine →
              </button>
            )}
          </div>

          <div className="line-items-header">
            <button
              type="button"
              className="btn-secondary"
              disabled={approving}
              onClick={() => onEditJobSheet(selected.id)}
            >
              Edit (add expenses, change lines…)
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={approving}
              onClick={() => handleApprove(selected)}
            >
              {approving ? "Approving…" : "Approve"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
