import { useEffect, useState } from "react";
import {
  convertJobSheetToInvoice,
  deleteJobSheetFile,
  fetchAllJobSheets,
  fetchCompanies,
  fetchJobSheetFiles,
  fetchSyncQueueForJobSheet,
  getJobSheetFileDownloadUrl,
  retryJobSheet,
  uploadJobSheetFile,
  type SyncQueueEntry,
} from "../lib/jobSheets";
import type { Company, JobSheet, JobSheetFile } from "../types";
import { JobSheetDocument } from "./JobSheetDocument";
import { errorMessage } from "../lib/errors";

const STATUS_LABELS: Record<JobSheet["status"], string> = {
  draft: "Draft",
  approved: "Approved — queuing",
  queued: "Syncing…",
  synced: "Synced to QuickBooks",
  failed: "Failed",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function JobSheetHistory() {
  const [sheets, setSheets] = useState<JobSheet[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobSheet["status"] | "all">("all");

  const [queueEntries, setQueueEntries] = useState<SyncQueueEntry[]>([]);
  const [files, setFiles] = useState<JobSheetFile[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDocument, setShowDocument] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([fetchAllJobSheets(), fetchCompanies()])
      .then(([sheetsData, companiesData]) => {
        setSheets(sheetsData);
        setCompanies(companiesData);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(errorMessage(err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const selected = sheets.find((s) => s.id === selectedId) ?? null;

  function loadDetail(jobSheetId: string) {
    setDetailLoading(true);
    setActionError(null);
    Promise.all([fetchSyncQueueForJobSheet(jobSheetId), fetchJobSheetFiles(jobSheetId)])
      .then(([queue, fileList]) => {
        setQueueEntries(queue);
        setFiles(fileList);
      })
      .catch((err: unknown) => setActionError(errorMessage(err)))
      .finally(() => setDetailLoading(false));
  }

  function selectSheet(id: string) {
    setSelectedId(id);
    setShowDocument(false);
    loadDetail(id);
  }

  async function handleRetry(jobSheetId: string) {
    setBusy(true);
    setActionError(null);
    try {
      await retryJobSheet(jobSheetId);
      load();
      loadDetail(jobSheetId);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleConvertToInvoice(jobSheetId: string) {
    setBusy(true);
    setActionError(null);
    try {
      await convertJobSheetToInvoice(jobSheetId);
      load();
      loadDetail(jobSheetId);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(jobSheetId: string, fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      for (const file of Array.from(fileList)) {
        await uploadJobSheetFile(jobSheetId, file);
      }
      loadDetail(jobSheetId);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(file: JobSheetFile) {
    try {
      const url = await getJobSheetFileDownloadUrl(file.storagePath);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleDeleteFile(file: JobSheetFile) {
    if (!window.confirm(`Remove "${file.fileName}" from this job sheet?`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteJobSheetFile(file.id, file.storagePath);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p>Loading job sheets…</p>;
  if (loadError) return <div className="banner banner-error">{loadError}</div>;

  const visibleSheets =
    statusFilter === "all" ? sheets : sheets.filter((s) => s.status === statusFilter);

  const companyName = selected ? companies.find((c) => c.id === selected.companyId)?.name ?? "" : "";

  return (
    <div className="approval-view">
      <div className="approval-list">
        <div className="field" style={{ marginBottom: "0.75rem" }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="all">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {visibleSheets.length === 0 && <p>No job sheets match this filter.</p>}

        {visibleSheets.map((sheet) => (
          <button
            key={sheet.id}
            type="button"
            className={`approval-list-item ${sheet.id === selectedId ? "selected" : ""}`}
            onClick={() => selectSheet(sheet.id)}
          >
            <strong>{sheet.customerNameRaw || "Unnamed customer"}</strong>
            <span>{sheet.jobDescription || "No description"}</span>
            <span className={sheet.status === "failed" ? "margin-flag" : ""}>
              {STATUS_LABELS[sheet.status]}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="approval-detail">
          <h3>{selected.customerNameRaw || "Unnamed customer"}</h3>
          <p>{selected.jobDescription}</p>
          <p>
            <strong>Status:</strong> {STATUS_LABELS[selected.status]}
            {selected.qbdEstimateTxnId && <> — Estimate #{selected.qbdEstimateTxnId}</>}
            {selected.qbdInvoiceTxnId && <> — Invoice #{selected.qbdInvoiceTxnId}</>}
          </p>

          <div className="financial-grid">
            <span>Client total (incl. VAT)</span>
            <strong>R {selected.clientTotal.toFixed(2)}</strong>
            <span>Expense total</span>
            <strong>R {selected.expenseTotal.toFixed(2)}</strong>
            <span>Net profit</span>
            <strong>R {selected.netProfit.toFixed(2)}</strong>
          </div>

          {actionError && <div className="banner banner-error">{actionError}</div>}

          <div className="line-items-header" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn-secondary" onClick={() => setShowDocument(true)}>
              View / print quote
            </button>
            {(selected.status === "failed" || queueEntries.some((q) => q.status === "failed")) && (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => handleRetry(selected.id)}
              >
                {busy ? "Retrying…" : "Retry sync"}
              </button>
            )}
            {selected.status === "synced" && !selected.qbdInvoiceTxnId && (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => handleConvertToInvoice(selected.id)}
              >
                {busy ? "Converting…" : "Convert to Invoice"}
              </button>
            )}
          </div>

          {showDocument && (
            <JobSheetDocument
              job={selected}
              companyName={companyName}
              onClose={() => setShowDocument(false)}
            />
          )}

          <h4 style={{ marginTop: "1.5rem" }}>Sync history</h4>
          {detailLoading ? (
            <p>Loading…</p>
          ) : queueEntries.length === 0 ? (
            <p className="field-hint">Not queued yet.</p>
          ) : (
            <ul className="sync-history-list">
              {queueEntries.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.action}</strong> — {entry.status}
                  {entry.qbdTxnId && <> (QBD #{entry.qbdTxnId})</>}
                  {entry.errorMessage && (
                    <div className="banner banner-error">{entry.errorMessage}</div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h4 style={{ marginTop: "1.5rem" }}>Attached files</h4>
          <label className="btn-secondary" style={{ display: "inline-block", cursor: "pointer" }}>
            {busy ? "Uploading…" : "+ Attach a file"}
            <input
              type="file"
              multiple
              style={{ display: "none" }}
              disabled={busy}
              onChange={(e) => handleUpload(selected.id, e.target.files)}
            />
          </label>
          {files.length === 0 ? (
            <p className="field-hint">No files attached yet.</p>
          ) : (
            <ul className="sync-history-list">
              {files.map((file) => (
                <li key={file.id}>
                  <button type="button" className="link-button" onClick={() => handleDownload(file)}>
                    {file.fileName}
                  </button>{" "}
                  <span className="field-hint">
                    ({formatBytes(file.sizeBytes)}, {new Date(file.uploadedAt).toLocaleDateString("en-ZA")})
                  </span>{" "}
                  <button type="button" className="btn-icon" onClick={() => handleDeleteFile(file)}>
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
