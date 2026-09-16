import { useEffect, useRef, useState } from "react";
import {
  approveJobSheet,
  deleteJobSheetDraft,
  fetchAllJobSheets,
  fetchCompanies,
  mergeDraftJobSheets,
} from "../lib/jobSheets";
import { fetchLatestNsaQuoteForClient, fetchNsaQuoteById } from "../lib/nsaQuotes";
import { fetchNsaQboCustomerByQboId } from "../lib/nsaQboCustomers";
import { convertJobSheetToNsaInvoice, convertJobSheetToNsaQuote } from "../lib/jobSheetToNsaQuote";
import type { Company, JobSheet } from "../types";
import type { NsaQuote } from "../nsaTypes";
import { errorMessage } from "../lib/errors";

interface ApprovalViewProps {
  onEditJobSheet: (id: string) => void;
}

const EMPTY_QUOTE_FIELDS = {
  vendorNumber: "",
  poNumber: "",
  clientAddress: "",
};

export function ApprovalView({ onEditJobSheet }: ApprovalViewProps) {
  // Every job sheet regardless of status — this screen used to only fetch
  // drafts, so a job sheet vanished with no way back to it the moment it was
  // approved (there was nowhere left to click "Create Quote/Invoice" from).
  // statusTab below filters what's actually shown.
  const [jobSheets, setJobSheets] = useState<JobSheet[]>([]);
  const [statusTab, setStatusTab] = useState<"all" | "draft" | "approved">("all");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [companyTab, setCompanyTab] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Temp tool (2026-09-07): combine several drafts for the same job into one
  // before approving. Deliberately kept out of the normal toolbar — this is a
  // discreet, occasional-use link rather than a permanent button.
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelectedIds, setMergeSelectedIds] = useState<Set<string>>(new Set());
  const [mergeDescription, setMergeDescription] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // NSA quote hand-off state.
  const [quoteFormOpen, setQuoteFormOpen] = useState(false);
  const [quoteFields, setQuoteFields] = useState(EMPTY_QUOTE_FIELDS);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteMessage, setQuoteMessage] = useState<string | null>(null);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  // The already-created quote for the selected sheet, if any — fetched only
  // to warn if it's moved past draft (see the drift note near "Edit" below).
  const [linkedQuote, setLinkedQuote] = useState<NsaQuote | null>(null);

  // Bumped on every openQuoteForm/selection change so a slow response from an
  // earlier lookup can never overwrite fields for whatever is selected now —
  // without this, switching drafts mid-lookup (or reopening the form fast)
  // could inject a different client's vendor number/address, or clobber
  // something the user had already started typing.
  const prefillRequestId = useRef(0);

  function load() {
    setLoading(true);
    Promise.all([fetchAllJobSheets(), fetchCompanies()])
      .then(([sheetData, companyData]) => {
        setJobSheets(sheetData);
        setCompanies(companyData);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const selected = jobSheets.find((d) => d.id === selectedId) ?? null;
  const selectedCompanyName = companies.find((c) => c.id === selected?.companyId)?.name ?? "";
  // NSA holds the vendor-number relationship with the mines African Nomad
  // works for; Tuscany SA has its own separate silent-partner flow (see
  // AN_JOBSHEET_SYSTEM_CONTEXT.md). NSA-branded paperwork must only ever
  // come from an African Nomad job — the database enforces this too
  // (create_nsa_quote_from_job_sheet), this just keeps the button from being
  // offered somewhere it would always be rejected.
  const canQuoteViaNsa = selectedCompanyName === "African Nomad";

  // Selecting a different job sheet abandons any half-filled quote form —
  // carrying one sheet's quote number over to another would be a nasty way to
  // burn one of NSA's numbers on the wrong job.
  useEffect(() => {
    prefillRequestId.current += 1;
    setQuoteFormOpen(false);
    setQuoteFields(EMPTY_QUOTE_FIELDS);
    setQuoteError(null);
    setQuoteMessage(null);
    setPrefillNote(null);
  }, [selectedId]);

  // Once a job sheet has a linked NSA quote, fetch it so we can warn if it's
  // already moved past draft — editing the job sheet at that point won't
  // update the document the client already has.
  useEffect(() => {
    // Clear immediately, before the fetch starts — otherwise the previous
    // sheet's quote (number and status) stays on screen under the newly
    // selected sheet's heading for as long as this request is in flight.
    setLinkedQuote(null);
    if (!selected?.nsaQuoteId) return;
    let cancelled = false;
    fetchNsaQuoteById(selected.nsaQuoteId)
      .then((quote) => {
        if (!cancelled) setLinkedQuote(quote);
      })
      .catch(() => {
        if (!cancelled) setLinkedQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.nsaQuoteId]);

  // Vendor number and address belong to the NSA-to-mine relationship, not to
  // the job, so they're the same on every quote to that mine. Prefer the real
  // QBO customer link (set when the job sheet was created — see
  // JobSheetForm's "Link to a real QuickBooks customer" field): it's a direct
  // id match, so it works even for a client that's never been quoted before.
  // Falls back to the old "last quote with a matching client_name" guess only
  // when there's no link, e.g. a job sheet created before this existed.
  async function openQuoteForm(jobSheet: JobSheet) {
    setQuoteFormOpen(true);
    setQuoteError(null);
    setQuoteMessage(null);
    const requestId = ++prefillRequestId.current;
    try {
      if (jobSheet.qboCustomerId) {
        const customer = await fetchNsaQboCustomerByQboId(jobSheet.qboCustomerId);
        if (prefillRequestId.current !== requestId) return;
        if (customer) {
          setQuoteFields({
            ...EMPTY_QUOTE_FIELDS,
            vendorNumber: customer.vendorNumber,
            clientAddress: customer.billAddress,
          });
          setPrefillNote("Vendor number and address filled in from the linked QuickBooks customer.");
          return;
        }
      }

      const previous = await fetchLatestNsaQuoteForClient(jobSheet.customerNameRaw);
      if (prefillRequestId.current !== requestId) return; // stale — a newer lookup superseded this one
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
      if (prefillRequestId.current !== requestId) return;
      // Prefill is a convenience, never a blocker — the fields are all
      // editable anyway, so a lookup failure just means typing them.
      setPrefillNote(`Couldn't load previous quote details: ${errorMessage(err)}`);
    }
  }

  async function handleCreateNsaDoc(jobSheet: JobSheet, kind: "quote" | "invoice") {
    setQuoteError(null);
    setQuoteMessage(null);
    setQuoteBusy(true);
    try {
      const { quote, pushError } =
        kind === "quote"
          ? await convertJobSheetToNsaQuote(jobSheet, quoteFields)
          : await convertJobSheetToNsaInvoice(jobSheet, quoteFields);

      if (pushError) {
        setQuoteMessage(
          `NSA ${kind} created, but pushing it to QuickBooks failed (${pushError}). ` +
            'Open the NSA Quotes tab and use "Push to QuickBooks Online" to retry.',
        );
      } else {
        setQuoteMessage(
          `NSA ${kind} ${quote.quoteNumber || "(unnumbered)"} created in QuickBooks — open the NSA Quotes tab to view or print it.`,
        );
      }
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

  async function handleDelete(jobSheet: JobSheet) {
    setDeleteError(null);
    const confirmed = window.confirm(
      `Permanently delete this draft job sheet for ${jobSheet.customerNameRaw || "this customer"}? ` +
        "This cannot be undone.",
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteJobSheetDraft(jobSheet.id);
      setSelectedId(null);
      load();
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  function toggleMergeMode() {
    setMergeMode((on) => !on);
    setMergeSelectedIds(new Set());
    setMergeDescription("");
    setMergeError(null);
    setSelectedId(null);
  }

  function toggleMergeSelected(id: string) {
    setMergeSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Merging only ever makes sense for drafts (mergeDraftJobSheets itself
  // rejects anything else) — restrict the candidate pool regardless of
  // whatever statusTab the main list is currently showing.
  const mergeCandidates = jobSheets.filter((d) => d.status === "draft" && mergeSelectedIds.has(d.id));

  async function handleCombine() {
    setMergeError(null);
    const description = mergeDescription.trim();
    if (!description) {
      setMergeError("Give the combined job sheet a description first.");
      return;
    }
    const companyName = companies.find((c) => c.id === mergeCandidates[0]?.companyId)?.name ?? "";
    const confirmed = window.confirm(
      `Combine these ${mergeCandidates.length} drafts into one job sheet ("${description}")? ` +
        "The original drafts will be deleted once the combined one is saved.",
    );
    if (!confirmed) return;

    setMerging(true);
    try {
      await mergeDraftJobSheets(mergeCandidates, companyName, description);
      toggleMergeMode();
      load();
    } catch (err) {
      setMergeError(errorMessage(err));
    } finally {
      setMerging(false);
    }
  }

  if (loading) return <p>Loading job sheets…</p>;
  if (loadError) return <div className="banner banner-error">{loadError}</div>;
  if (jobSheets.length === 0) return <p>No job sheets yet.</p>;

  const byStatus =
    statusTab === "all" ? jobSheets : jobSheets.filter((d) => d.status === statusTab);
  const byCompany =
    companyTab === "all" ? byStatus : byStatus.filter((d) => d.companyId === companyTab);
  const searchTerm = search.trim().toLowerCase();
  const visibleJobSheets = searchTerm
    ? byCompany.filter(
        (d) =>
          d.customerNameRaw.toLowerCase().includes(searchTerm) ||
          d.jobDescription.toLowerCase().includes(searchTerm),
      )
    : byCompany;

  return (
    <div className="approval-view">
      <div className="approval-list">
        <div className="company-tabs">
          <button
            type="button"
            className={statusTab === "all" ? "active" : ""}
            onClick={() => setStatusTab("all")}
          >
            All
          </button>
          <button
            type="button"
            className={statusTab === "draft" ? "active" : ""}
            onClick={() => setStatusTab("draft")}
          >
            Draft
          </button>
          <button
            type="button"
            className={statusTab === "approved" ? "active" : ""}
            onClick={() => setStatusTab("approved")}
          >
            Approved
          </button>
        </div>

        <div className="company-tabs">
          <button
            type="button"
            className={companyTab === "all" ? "active" : ""}
            onClick={() => setCompanyTab("all")}
          >
            All companies
          </button>
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              className={companyTab === c.id ? "active" : ""}
              onClick={() => setCompanyTab(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <input
          type="search"
          className="job-sheet-search"
          placeholder="Search by customer or job description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {visibleJobSheets.length === 0 && <p>No job sheets match this filter.</p>}

        {visibleJobSheets.map((sheet) =>
          mergeMode ? (
            <label
              key={sheet.id}
              className={`approval-list-item merge-selectable ${sheet.status !== "draft" ? "merge-disabled" : ""}`}
            >
              <span className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={mergeSelectedIds.has(sheet.id)}
                  disabled={sheet.status !== "draft"}
                  onChange={() => toggleMergeSelected(sheet.id)}
                />
                Select
              </span>
              <strong>{sheet.customerNameRaw || "Unnamed customer"}</strong>
              <span>{sheet.jobDescription || "No description"}</span>
              <span>Profit margin {sheet.netMarginPct.toFixed(1)}%</span>
            </label>
          ) : (
            <button
              key={sheet.id}
              type="button"
              className={`approval-list-item ${sheet.id === selectedId ? "selected" : ""}`}
              onClick={() => setSelectedId(sheet.id)}
            >
              <strong>{sheet.customerNameRaw || "Unnamed customer"}</strong>
              <span>{sheet.jobDescription || "No description"}</span>
              <span>Profit margin {sheet.netMarginPct.toFixed(1)}%</span>
              <span className="nsa-status-badge">{sheet.status}</span>
            </button>
          ),
        )}

        {mergeMode && (
          <div className="merge-panel">
            <p className="field-hint">{mergeCandidates.length} selected</p>
            <input
              type="text"
              className="job-sheet-search"
              placeholder="Combined job description…"
              value={mergeDescription}
              onChange={(e) => setMergeDescription(e.target.value)}
            />
            {mergeError && <div className="banner banner-error">{mergeError}</div>}
            <div className="line-items-header">
              <button type="button" className="btn-secondary" disabled={merging} onClick={toggleMergeMode}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={merging || mergeCandidates.length < 2}
                onClick={handleCombine}
              >
                {merging ? "Combining…" : `Combine ${mergeCandidates.length} into one`}
              </button>
            </div>
          </div>
        )}

        {!mergeMode && (
          <button type="button" className="link-button" onClick={toggleMergeMode}>
            combine drafts…
          </button>
        )}
      </div>

      {selected && (
        <div className="approval-detail">
          <h3>{selected.customerNameRaw || "Unnamed customer"}</h3>
          <p>{selected.jobDescription}</p>
          {selected.eventDate && <p>Event date: {selected.eventDate}</p>}

          <div className="financial-grid">
            <span>Client total (incl. VAT)</span>
            <strong>R {selected.clientTotal.toFixed(2)}</strong>
            <span>Supplier expenses</span>
            <strong>R {selected.expenseTotal.toFixed(2)}</strong>
            {selected.sibanyeRebate > 0 && (
              <>
                <span>Sibanye 2.5%</span>
                <strong>R {selected.sibanyeRebate.toFixed(2)}</strong>
              </>
            )}
            <span>Total expenses</span>
            <strong>R {selected.totalCosts.toFixed(2)}</strong>
            <span>Gross profit</span>
            <strong>R {selected.grossProfit.toFixed(2)}</strong>
            <span>Total fees (NSA/Tuscany)</span>
            <strong>R {selected.totalFees.toFixed(2)}</strong>
            <span>Net profit</span>
            <strong>R {selected.netProfit.toFixed(2)}</strong>
          </div>

          {approveError && <div className="banner banner-error">{approveError}</div>}
          {deleteError && <div className="banner banner-error">{deleteError}</div>}
          {quoteError && <div className="banner banner-error">{quoteError}</div>}
          {quoteMessage && <div className="banner banner-success">{quoteMessage}</div>}

          <div className="nsa-handoff">
            {selected.nsaQuoteId ? (
              <p className="field-hint">
                NSA quote already created for this job sheet — find it in the NSA Quotes tab.
              </p>
            ) : !canQuoteViaNsa ? (
              <p className="field-hint">
                NSA quotes are only created from African Nomad jobs — {selectedCompanyName || "this company"}
                {" "}has its own separate process.
              </p>
            ) : quoteFormOpen ? (
              <>
                <h4>Create the NSA quote or invoice for the mine</h4>
                <p className="section-description">
                  Copies the {selected.clientLines.length} client line
                  {selected.clientLines.length === 1 ? "" : "s"} onto an NSA-branded document and
                  pushes it straight into QuickBooks — the quote/invoice number comes back from
                  QuickBooks itself, not typed by hand. Supplier costs never cross over — the mine
                  only ever sees NSA.
                </p>
                {prefillNote && <p className="field-hint">{prefillNote}</p>}

                <div className="nsa-handoff-fields">
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
                    className="btn-secondary"
                    disabled={quoteBusy}
                    onClick={() => handleCreateNsaDoc(selected, "quote")}
                  >
                    {quoteBusy ? "Creating…" : "Create Quote in QuickBooks"}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={quoteBusy}
                    onClick={() => handleCreateNsaDoc(selected, "invoice")}
                  >
                    {quoteBusy ? "Creating…" : "Create Invoice in QuickBooks"}
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
                Create NSA quote or invoice for the mine →
              </button>
            )}
          </div>

          {linkedQuote && linkedQuote.status !== "draft" && (
            <div className="banner banner-warning">
              This job sheet's NSA quote (#{linkedQuote.quoteNumber || "unnumbered"}) has already
              been {linkedQuote.status === "sent" ? "sent to" : linkedQuote.status === "accepted" ? "accepted by" : "invoiced to"} the
              client. Editing lines, customer, or discount here will NOT update that document —
              if pricing needs to change, correct the NSA quote directly or contact the client.
            </div>
          )}

          <div className="line-items-header">
            <button
              type="button"
              className="btn-secondary"
              disabled={approving}
              onClick={() => onEditJobSheet(selected.id)}
            >
              Edit (add expenses, change lines…)
            </button>
            {selected.status === "draft" && (
              <button
                type="button"
                className="btn-danger"
                disabled={approving || deleting}
                onClick={() => handleDelete(selected)}
              >
                {deleting ? "Deleting…" : "Delete draft"}
              </button>
            )}
            {selected.status === "draft" ? (
              <button
                type="button"
                className="btn-primary"
                disabled={approving}
                onClick={() => handleApprove(selected)}
              >
                {approving ? "Approving…" : "Approve"}
              </button>
            ) : (
              <span className="nsa-status-badge">Status: {selected.status}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
