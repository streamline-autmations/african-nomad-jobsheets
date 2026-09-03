import { useState } from "react";
import { JobSheetForm } from "./components/JobSheetForm";
import { ApprovalView } from "./components/ApprovalView";
import { NsaQuoteForm } from "./components/NsaQuoteForm";
import { NsaQuoteList } from "./components/NsaQuoteList";
import { supabaseConfigured } from "./lib/supabase";

type Tab = "new" | "approvals" | "nsa-new" | "nsa-quotes";

export default function App() {
  const [tab, setTab] = useState<Tab>("new");
  // Bumped after saving a new NSA quote so NsaQuoteList refetches when the
  // user switches to it, without the two components needing to share state.
  const [nsaQuoteListKey, setNsaQuoteListKey] = useState(0);
  // Set by Approvals' "Edit" button, read by JobSheetForm to load that draft
  // instead of starting blank — cleared once the edit is saved.
  const [editJobSheetId, setEditJobSheetId] = useState<string | null>(null);

  return (
    <div className={`app-shell${tab === "new" ? " app-shell-wide" : ""}`}>
      <header className="app-header">
        <h1>African Nomad — Job Sheets</h1>
        <nav className="app-nav">
          <button
            type="button"
            className={tab === "new" ? "active" : ""}
            onClick={() => {
              setEditJobSheetId(null);
              setTab("new");
            }}
          >
            New Job Sheet
          </button>
          <button
            type="button"
            className={tab === "approvals" ? "active" : ""}
            onClick={() => setTab("approvals")}
          >
            Approved Job Sheets
          </button>
          <button
            type="button"
            className={tab === "nsa-new" ? "active" : ""}
            onClick={() => setTab("nsa-new")}
          >
            New NSA Quote
          </button>
          <button
            type="button"
            className={tab === "nsa-quotes" ? "active" : ""}
            onClick={() => setTab("nsa-quotes")}
          >
            NSA Quotes
          </button>
        </nav>
      </header>

      <main className="app-main">
        {!supabaseConfigured && (
          <div className="banner banner-error">
            Supabase isn&apos;t configured — set VITE_SUPABASE_URL and
            VITE_SUPABASE_ANON_KEY in your .env.local.
          </div>
        )}
        {tab === "new" && (
          <JobSheetForm
            editJobSheetId={editJobSheetId}
            onEditSaved={() => {
              setEditJobSheetId(null);
              setTab("approvals");
            }}
          />
        )}
        {tab === "approvals" && (
          <ApprovalView
            onEditJobSheet={(id) => {
              setEditJobSheetId(id);
              setTab("new");
            }}
          />
        )}
        {tab === "nsa-new" && (
          <NsaQuoteForm
            onSaved={() => {
              setNsaQuoteListKey((k) => k + 1);
              setTab("nsa-quotes");
            }}
          />
        )}
        {tab === "nsa-quotes" && <NsaQuoteList key={nsaQuoteListKey} />}
      </main>

      <footer className="app-footer">
        <a href="mailto:admin@africannomad.co.za">Support: admin@africannomad.co.za</a>
        <span aria-hidden="true"> · </span>
        <a href="/legal/privacy.html" target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
        <span aria-hidden="true"> · </span>
        <a href="/legal/eula.html" target="_blank" rel="noreferrer">
          Terms
        </a>
      </footer>
    </div>
  );
}
