import { useEffect, useState } from "react";
import { approveJobSheet, fetchDraftJobSheets } from "../lib/jobSheets";
import type { JobSheet } from "../types";

export function ApprovalView() {
  const [drafts, setDrafts] = useState<JobSheet[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchDraftJobSheets()
      .then((data) => {
        setDrafts(data);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const selected = drafts.find((d) => d.id === selectedId) ?? null;

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
      setApproveError(err instanceof Error ? err.message : String(err));
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

          <button
            type="button"
            className="btn-primary"
            disabled={approving}
            onClick={() => handleApprove(selected)}
          >
            {approving ? "Approving…" : "Approve"}
          </button>
        </div>
      )}
    </div>
  );
}
