import { useState } from "react";
import { JobSheetForm } from "./components/JobSheetForm";
import { ApprovalView } from "./components/ApprovalView";
import { supabaseConfigured } from "./lib/supabase";

type Tab = "new" | "approvals";

export default function App() {
  const [tab, setTab] = useState<Tab>("new");

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>African Nomad — Job Sheets</h1>
        <nav className="app-nav">
          <button
            type="button"
            className={tab === "new" ? "active" : ""}
            onClick={() => setTab("new")}
          >
            New Job Sheet
          </button>
          <button
            type="button"
            className={tab === "approvals" ? "active" : ""}
            onClick={() => setTab("approvals")}
          >
            Approvals
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
        {tab === "new" ? <JobSheetForm /> : <ApprovalView />}
      </main>
    </div>
  );
}
