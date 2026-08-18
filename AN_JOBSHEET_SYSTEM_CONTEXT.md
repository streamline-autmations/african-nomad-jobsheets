# African Nomad — Job Sheet Automation System — Context

> Drop this file into the project root as `CLAUDE.md` or reference it at the start of any Claude Code session on this build.

---

## Business background

African Nomad is a South African multi-vertical company (mining sector supply, catering/food service, corporate gifting, event services). It operates through **two legal/accounting entities**:

- **African Nomad** — contracts work through NSA
- **Tuscany SA** — has a silent partner

Both currently book through **one shared QuickBooks Desktop (QBD)** company file (not QuickBooks Online). Confirm QBD edition (Pro/Premier/Enterprise) before assuming Web Connector/SDK support — this needs to be checked, don't assume Pro.

### The NSA relationship (why client-facing paperwork can never show African Nomad)

NSA is a separate company (Christiaan does not control her books or systems) that holds active **vendor numbers with the mines** AN works for. African Nomad does not have its own vendor numbers with these mines, so structurally:

- The mine's actual contract of record is with **NSA**, not African Nomad.
- The mine gives the job to NSA; **NSA subcontracts the real work out to AN**.
- Every document a mine ever sees — Quote and Invoice — must be **100% NSA-branded**. No African Nomad name, logo, letterhead, or reference may appear anywhere in client-facing paperwork.
- AN still does the actual work and needs accurate internal books. Once a job is won, AN creates a real Estimate/Invoice inside **its own QBD company file** (Company = African Nomad, Customer = the real mine, e.g. Sibanye Stillwater) — this is purely AN's internal record and is never seen by the mine. This is the existing Job Sheet App / QBD Bridge pipeline described below — it does not need to change for this reason.
- On top of the normal fee cascade, AN pays NSA **10% of gross profit** for the use of her vendor number/relationship. This is already modelled as `nsa_fee` in the schema/fee logic below — no change needed there.
- Paper trail: AN issues its own invoice to NSA for the job value; NSA in turn invoices the mine (client-facing, full amount) and pays AN back the job value minus her 10% cut.
- Because Christiaan does not currently have access to NSA's real QuickBooks Online account (and doesn't want to risk breaking her live system even once he does), the client-facing NSA Quote/Invoice paperwork is handled by a **separate, standalone tool** — see "Component 2 — NSA Quote System" near the end of this doc. It is deliberately kept apart from the AN Job Sheet App and its Supabase tables.

The founder (Christiaan) is taking over the books and replacing an inherited, fragile Excel-based "job sheet" process (a leftover template from an unrelated system called "Chase Software," full of manual formulas and no structure) with a proper automated pipeline.

**Non-negotiable rule across the whole system:** no financial action (creating a quote, sending an invoice, posting a bill) happens without an explicit human approval step. Automation drafts and prepares — a human always approves the consequential action.

---

## Why QBD changes the architecture (read this before designing anything)

This is **QuickBooks Desktop**, not QuickBooks Online. That means:

- No modern REST API. Desktop only speaks **qbXML** via the **QuickBooks Desktop SDK**.
- The only way to get data in/out is via **QuickBooks Web Connector (QBWC)** — a Windows app that runs on the same machine as QuickBooks Desktop, and **polls out** to a SOAP endpoint we control. It cannot be pushed to from the cloud — the laptop always has to initiate contact. There is no webhook equivalent.
- QuickBooks Desktop (and Web Connector) must be **open/running on the laptop** for any sync to happen. If QB is closed, everything queues and waits.
- The `.QBW` company file must **NOT** live inside an actively-syncing OneDrive folder while in use — file lock conflicts with cloud sync cause corruption. If OneDrive is used for cross-laptop access, it should hold periodic `.QBB` backup copies, not the live file. (Flag this to Christiaan if it comes up — his current plan was to keep the live file OneDrive-synced.)

### The concurrency model
- QBD supports native **multi-user mode** for concurrent human users.
- Web Connector effectively acts as an additional "user" connecting via qbXML — the company file should be in **multi-user mode** so QBWC and human users don't lock each other out.

### Getting close to "instant" despite polling
Web Connector's own update interval can go as low as ~1 minute but Intuit doesn't recommend faster. To get closer to instant without violating that:
- A **local helper script** on the laptop polls Supabase every 5–10 seconds for new `pending` rows in the sync queue.
- The moment it sees one, it triggers Web Connector's **on-demand update** (command-line triggerable, not just its own internal timer).
- Realistic best case: approve a job sheet → real Estimate in QBD within ~60–90 seconds, provided QuickBooks Desktop is open on that laptop at the time. If QB is closed, it queues until QB opens and Web Connector runs.

---

## System architecture (four components)

```
┌─────────────────────┐
│   Job Sheet App      │  React 18 + Vite + TS, same pattern as the sourcing engine
│   (Vercel-hosted)     │  Staff create job sheets; owner approves them
└──────────┬───────────┘
           │ writes to
           ▼
┌─────────────────────┐
│      Supabase         │  Source of truth. job_sheets, qbd_sync_queue,
│  (existing project)   │  customers (QBD mirror), common_expenses, companies
└──────────┬───────────┘
           │ polled by (every 5-10s)
           ▼
┌─────────────────────┐
│   Local Helper        │  Small script running ON THE LAPTOP.
│   (runs on laptop)     │  Watches Supabase queue, fires Web Connector on-demand
└──────────┬───────────┘
           │ triggers
           ▼
┌─────────────────────┐
│  QuickBooks Web       │  Standard Intuit tool, polls the Bridge, executes
│  Connector (QBWC)     │  qbXML requests against the real QBD company file
└──────────┬───────────┘
           │ talks qbXML/SOAP to
           ▼
┌─────────────────────┐
│   QBD Bridge          │  Custom service (Render-hosted, same instance as n8n
│   (Render-hosted)      │  or a sibling service). Implements the SOAP methods
│                        │  QBWC expects: authenticate, sendRequestXML,
│                        │  receiveResponseXML, closeConnection.
│                        │  Reads qbd_sync_queue, builds qbXML requests,
│                        │  writes results (txn IDs) back to Supabase.
└──────────┬───────────┘
           │ executes against
           ▼
   QuickBooks Desktop (.QBW company file, local to primary laptop)
```

---

## Existing infrastructure to reuse (do not duplicate)

| Component | Detail |
|---|---|
| Supabase project | `wnsjzxotknadqvznnijw` — add new tables here. **Signed in as `streamlinebuilds.2@gmail.com`** (see the note below — it is not the obvious account) |
| Supabase project (sourcing engine) | `mgqfoorchhbtlhvqscbl` — same login |
| n8n | Hosted on Render at `dockerfile-1n82.onrender.com`, editor at `/home` — same instance handles all AN automation |
| Vercel | Existing account, auto-deploys from GitHub — Job Sheet App should follow the same deploy pattern as the sourcing engine |
| Sourcing engine | Separate but related app — a Job Sheet line item may eventually pull cost directly from a sourcing engine result. Keep this in mind but don't couple tightly yet. |
| Frontend stack | React 18 + Vite + TypeScript — match the sourcing engine's conventions exactly (component structure, Supabase access pattern via a single `lib/` file, never direct component-to-Supabase calls) |

### ⚠️ Which Supabase login owns these projects

**`streamlinebuilds.2@gmail.com`.** Confirmed by Christiaan 2026-08-05.

This is worth stating loudly because it is *not* the account anyone would guess. `streamline.automations.hq@gmail.com` is the git `user.email` on these repos and is the Supabase notification address for every other project he owns (Website, Reckless-Admin, CX Electronics, streamline-admin, app.supabase.com, supabase-green-house) — but it does **not** own either African Nomad project. Neither does the `claude_ai_Supabase` connector's account.

Practical consequences:
- To resume, inspect, or migrate these databases, sign in as `streamlinebuilds.2@gmail.com`.
- The `sbp_` personal access token in `C:\Users\User\.mcp.json` belongs to the *other* account and cannot see these projects. Don't waste time with it.
- The repo-level `.mcp.json` points the `supabase-jobsheet` MCP server at `wnsjzxotknadqvznnijw`, but its OAuth was never completed (empty access token). Authorising it while signed in as the address above is the fastest way to get direct DB access.

---

## Supabase schema (starting point — refine as needed)

```sql
-- Reference/lookup tables
companies (
  id, name  -- 'African Nomad', 'Tuscany SA'
)

customers (  -- mirror of QBD's customer list
  id, qbd_list_id, name, last_synced_at
)

common_expenses (
  id, label  -- 'Accommodation', 'Casual Worker Labour', 'Delivery / Transport', etc.
)

-- Core table
job_sheets (
  id,
  company_id,
  customer_id,          -- nullable until matched/created in QBD
  customer_name_raw,     -- what staff typed, in case customer doesn't exist yet
  job_description,
  event_date,
  status,                -- draft / approved / queued / synced / failed
  client_lines,          -- jsonb: [{description, qty, unit_cost, line_total}]
  expense_lines,         -- jsonb: same shape
  client_subtotal, vat_amount, client_total,
  expense_total,
  gross_profit, profit_margin_pct,
  nsa_fee, sibanye_fee, tuscany_fee, total_fees,
  net_profit, net_margin_pct,
  qbd_estimate_txn_id,   -- nullable, filled once synced
  qbd_invoice_txn_id,    -- nullable, filled once invoiced
  created_at, approved_at, synced_at
)

-- Sync mechanism
qbd_sync_queue (
  id,
  job_sheet_id,
  action,               -- create_customer / create_estimate / create_invoice / create_bill
  payload,               -- jsonb, the data needed to build the qbXML request
  status,                -- pending / sent / confirmed / failed
  qbd_txn_id,            -- nullable, populated on confirm
  error_message,         -- nullable
  created_at, synced_at
)

-- Later, for supplier cost capture (not phase 1)
supplier_bills (
  id, job_sheet_id, supplier_name, amount, source (whatsapp/email),
  status, qbd_bill_txn_id, created_at
)
```

---

## Business logic: fee cascade (must be enforced in code, not just UI)

Given a job sheet's `company_id`, `customer_id`, and computed `gross_profit`:

- **If Company = African Nomad:**
  - `nsa_fee = gross_profit * 0.10` (always, since work is contracted through NSA — see "The NSA relationship" above)
  - Sibanye Stillwater gets a **2.5% discount on their invoice total** (their 30-day payment term earns them a real discount, not an internal-only cost to AN)
- **If Company = Tuscany SA:**
  - `tuscany_fee = gross_profit * 0.10` (goes to the silent partner)
- Fees are mutually exclusive by company — a job sheet is never both African Nomad and Tuscany SA.
- `total_fees = nsa_fee + tuscany_fee` (Sibanye's discount is not a "fee" in this sum — see correction below)
- `net_profit = gross_profit - total_fees`

This exact logic was already validated in an Excel bridge template (zero formula errors, tested with sample African Nomad + Sibanye Stillwater data). Match it precisely — this is not up for creative reinterpretation.

> **Fixed 2026-07-20** (was previously an internal-only profit deduction that never touched `clientTotal` — Christiaan confirmed that was wrong). `sibanyeFee` is renamed `sibanyeDiscount` throughout: `src/lib/feeCalculations.ts`, `types.ts`, `jobSheets.ts`, the `job_sheets.sibanye_discount` column (migration `202607200001_sibanye_discount_fix.sql`, applied to the live `wnsjzxotknadqvznnijw` project), and the `discount_amount` field now carried in the `create_estimate`/`create_invoice` queue payload. Christiaan confirmed VAT is 15% "on everything" — the discount is applied to `clientSubtotal` **before** VAT (VAT computed on the discounted subtotal), and only when Company = African Nomad (matches the prior scoping — Tuscany SA never gets it, even for that customer). The QBD Bridge (`bridge/src/qbxml/builders.ts`, `session.ts`) now emits a negative-rate discount line (item name from `QBD_DISCOUNT_ITEM_NAME`, default `"Sibanye Discount"`) before the VAT line, so the real Estimate/Invoice total in QBD reflects it too. All frontend and bridge tests updated and passing.

**Target margin:** informal target of 20%+ gross margin (not a hard rule, just a flag/indicator in the UI — do not block saving a job sheet that falls below it, just surface it visually).

---

## Human approval gates (enforce as real status transitions, not just UI text)

1. **Job sheet created** (status: `draft`) → owner reviews → **approves** (status: `approved`) → only then does anything get written to `qbd_sync_queue`
2. **Estimate created in QBD** → before sending to client, human approval required (this may live in QBD itself initially, or in the app later)
3. **Estimate accepted by client** → since QBD can't auto-detect acceptance, a human explicitly marks it "Accepted" in the app → this queues Invoice creation (linked to the original Estimate's `qbd_estimate_txn_id`)
4. **Invoice ready** → human approval before it's actually sent to the client

Do not build any path that skips these gates, even for "obviously fine" cases.

---

## Component 1 build order (phase 1 focus — confirmed with Christiaan)

1. **Supabase schema** — set up tables above
2. **Job Sheet App** (React/Vite/TS) — company dropdown, customer dropdown (reads from `customers` mirror table, with "create new" fallback), client/expense line item tables, live fee calculation matching the logic above, save → draft in `job_sheets`
3. **QBD Bridge** — the SOAP/qbXML service Web Connector talks to (this is the technically hardest part — budget real time for qbXML request/response format, and for testing against a real or sandbox QBD file)
4. **Local Helper** — the laptop-resident script polling Supabase and triggering Web Connector on-demand

Everything after this (supplier bill capture, job profitability rollups, cash flow, invoice chasing, monthly P&L) is a later phase — do not build ahead of this list without checking in.

---

## Component 2 — NSA Quote System (separate, standalone — built 2026-07-20)

### What this is and why it's a separate app

This is **not** a third option in the existing Job Sheet App's company dropdown, and it does **not** share the `job_sheets` / `companies` / `customers` tables above. Christiaan confirmed (2026-07-20) it should be a **standalone tool**, kept apart from the AN internal QBD pipeline, because it solves a different problem:

- The AN Job Sheet App (Component 1) produces AN's own **internal** Estimate/Invoice inside AN's QBD file (Company = African Nomad, Customer = the real mine) — never seen by the mine. That flow is correct as-is and needs no changes for this.
- The NSA Quote System produces the **client-facing** Quote (and later Invoice) that actually gets sent to the mine — and per "The NSA relationship" above, that document must be 100% NSA-branded with zero trace of African Nomad.

Originally the idea (from Christiaan's first message) was "build something based on QuickBooks Online." In reality: **NSA already has her own real QuickBooks Online account** that she currently uses to create these quotes. Christiaan does not have access to it yet (may request access, but hasn't as of 2026-07-20) and — even once he does — does not want to risk breaking her live system by building against it directly. Decision: **build a new, separate tool that simulates a QBO-style quote/invoice**, rather than integrating with her real account. If real API access to her QBO account is granted later and Christiaan wants a genuine integration at that point, treat that as a distinct future decision — don't assume it now.

### Requested UX parity with Component 1

Christiaan explicitly asked for the same pattern as the QBD side: fill in a job-sheet-style form → the system auto-generates the quote. For this tool, "auto-creates a quote" means generating a formatted, downloadable document (PDF or print view) styled to look like a genuine QuickBooks Online Estimate/Invoice — not a real API call, since there's no live integration target. Christiaan can download it and email it manually (native send-from-app was explicitly said not to matter).

### Proposed flow

1. Staff fill in an NSA quote form (mine/client name, job description, line items, qty/unit cost — same shape as the existing `LineItem` pattern) → system computes subtotal/VAT/total using NSA's own numbering sequence.
2. **Draft** quote reviewed by a human (same approval-gate philosophy as Component 1 — never auto-send) → downloaded/exported as an NSA-branded PDF → emailed to the mine manually.
3. Once the mine accepts, staff mark the quote **Accepted** in the tool.
4. Staff separately create the real AN Job Sheet in Component 1 (Company = African Nomad, Customer = the real mine) to kick off AN's own internal QBD Estimate/Invoice and the `nsa_fee` (10% of gross profit) calculation. This is a **manual hand-off**, not an automatic link, per Christiaan's "keep it separate" decision — flag to him as a possible future enhancement (a "convert to AN job sheet" button that pre-fills Component 1 from an accepted NSA quote) if the manual re-entry becomes annoying in practice.
5. Once the job is delivered, the same NSA tool can flip the accepted quote into an **NSA Invoice** (same branding, its own numbering) for download/email to the mine — this is the document that lets NSA collect from the mine and, per "The NSA relationship" above, is separate from AN's own invoice to NSA for the job value minus her 10% cut.

### Built (2026-07-20)

- **Data model:** `public.nsa_quotes` (migration `202607200002_nsa_quote_system.sql`, applied to the live `wnsjzxotknadqvznnijw` project) — `id, quote_number, vendor_number, client_name, client_address, job_description, event_date, status (draft/sent/accepted/invoiced), lines jsonb, subtotal, vat_amount, total, nsa_invoice_number, created_at, sent_at, accepted_at, invoiced_at`. Same RLS posture as `job_sheets` (anon read/insert/update, no delete). `quote_number` and `vendor_number` are **free text, not auto-generated** — staff type in whatever number NSA's own system would assign, since we don't know her real sequence and must not collide with it.
- **Branding:** NSA Mining (Pty) Ltd's real details, supplied by Christiaan from an actual NSA quote ("Quote 1291 from NSA Mining.pdf", to Harmony Kalgold), hardcoded in `src/lib/nsaCompany.ts`: name, address (10 Koedoe Street, Greenhills, Randfontein, Gauteng, 1759), VAT reg. 4210262269, email `amanda.steffen@nsamining.co.za`, phone +27 780956899. **No banking details supplied yet** — `bankName`/`bankAccountNumber`/`bankBranchCode` are empty placeholders in that file; the invoice view shows "Banking details to be confirmed" until Christiaan provides them. Logo image at `src/assets/nsa-mining-logo.jpg`.
- **App:** two new tabs in the same Vercel-hosted app (`NsaQuoteForm.tsx` for creating a draft or a direct invoice, `NsaQuoteList.tsx` for the status-transition list) — one app, isolated Supabase tables/lib (`src/lib/nsaQuotes.ts`, `src/nsaTypes.ts`), no shared code with the `job_sheets` path except generic money/line helpers (`round2`, `withLineTotal`, `VAT_RATE`) from `feeCalculations.ts`, plus the one deliberate coupling point below. NSA quotes have **no fee cascade / Sibanye-style discount** — that's AN-internal business logic that doesn't apply to NSA's own client-facing document.
- **Document rendering:** `NsaQuoteDocument.tsx` — a full-screen print view matching the real reference PDFs' layout (title + company block top-left, contact info + logo top-right, shaded Bill-to/Ship-to panel, a details row, line table, totals block). "Auto-creates a quote/invoice" means this view, not a real API call — Christiaan clicks **Print / Save as PDF** (`window.print()`, standard browser print-to-PDF, no new dependency) and downloads/emails it manually, exactly as asked. Money is formatted with comma thousand-separators (`R 268,000.00`) to match the real documents, not the app's usual `toFixed(2)`.
- **Quote vs Invoice layout differs**, matching the two real reference PDFs exactly:
  - **Quote**: details row shows Quote no./date on the left, Vendor Number on the right; footer has "Accepted date"/"Accepted by" signature lines. No PO number, no banking details.
  - **Invoice**: details row shows Invoice no./date on the left, **Purchase Order no.** and **Vendor no.** stacked on the right; a banking-details block (bank name, account type, account number, branch code — from `NSA_COMPANY`, sourced from the real reference invoice "Invoice NSA06384 Beanies 2.pdf") sits to the left of the totals block, matching the reference layout. No "Accepted" footer.
- **Two ways to create an invoice** (added 2026-07-20, per Christiaan's request): (1) the original flow — draft quote → Mark as Sent → Mark as Accepted → Flip to Invoice; (2) a direct "Invoice (no quote first)" toggle on the same creation form, for jobs that never had a formal quote (e.g. the reference Beanies invoice to an individual, Christo Naude) — skips straight to status `invoiced`.
- **`po_number` and `an_job_sheet_id`** added to `nsa_quotes` (migration `202607200003_nsa_invoice_fields.sql`) — `po_number` is free text (blank renders as "N/A", matching NSA's own template), `an_job_sheet_id` is a soft pointer to `job_sheets.id` recording that the one-click conversion below has already run for a given quote/invoice.
- **Automated the AN Job Sheet hand-off** (previously manual, now done): `src/lib/nsaToJobSheet.ts` — `convertNsaQuoteToJobSheet()` is the **one deliberate coupling point** between Component 2 and Component 1. It looks up the "African Nomad" company via Component 1's own `fetchCompanies()`, then calls Component 1's own `saveJobSheetDraft()` (Customer = the NSA quote's client name, as a new customer; line items copied across as-is) — it does **not** touch `qbd_sync_queue` directly, so Component 1's human-approval gate still applies before anything reaches QuickBooks. A "Create AN Job Sheet" button appears in `NsaQuoteList` once a quote is `accepted` or `invoiced` and hasn't been converted yet; once clicked, `an_job_sheet_id` is recorded and the button disappears (shows "AN Job Sheet already created" instead) so it can't fire twice.
- **Status flow implemented:** draft → Mark as Sent → Mark as Accepted → (enter NSA's invoice number) → Flip to Invoice — or direct-to-invoice as above — each a human-clicked action (no auto-detection), matching the same approval-gate philosophy as Component 1.
- **Verified working end-to-end** in the browser against the live Supabase project, twice: (1) a quote replicating the real Harmony Kalgold example (800 × R335 = R268,000, VAT R40,200, total R308,200), printed layout matches; (2) a direct invoice replicating the real Beanies example (R70 + VAT = R80.50), printed layout matches including the banking block, and the "Create AN Job Sheet" button correctly created a linked job sheet in Component 1's Approvals list with matching totals, then correctly disappeared afterwards. Test rows cleaned up from the live DB after verifying.

### Open items still outstanding

- Get access to NSA's real QuickBooks Online account (he may request this) — once obtained, revisit whether the simulated tool is still the right call or a genuine API integration is worth it. QBO's real API (REST + OAuth) is far simpler than QBD's qbXML/SOAP dance, so this would be a much lighter lift than Component 1 if it's ever wanted.

## QBO OAuth scaffold (built 2026-07-21, not yet connected to a real company)

Christiaan registered an Intuit Developer app and needs to complete Intuit's app-assessment wizard (Compliance tab: EULA/Privacy Policy URLs, host domain, Launch/Disconnect/Connect-Reconnect URLs, category, industries, hosting) to unlock production keys. This is real OAuth2 infrastructure — a first step toward eventually replacing "Component 2 is simulated" above, once NSA authorizes a real connection — not just form-filling.

- **Legal pages:** `public/legal/privacy.html` and `public/legal/eula.html` — plain static HTML (deliberately not React-rendered, so they work independent of the app bundle/JS and are trivially crawlable by Intuit's reviewers). Issued under African Nomad Pty Ltd (`admin@africannomad.co.za`), not NSA — Christiaan confirmed AN is the actual developer/operator of record.
- **`vercel.json`** rewrite pattern changed from a blanket `/(.*)` catch-all to `/((?!api/|legal/).*)`, so the new `/api/*` functions and `/legal/*` static pages aren't swallowed by the SPA's `index.html` fallback.
- **OAuth endpoints** — new `api/qbo/` serverless functions (Vercel Node functions, plain `fetch`, no extra HTTP client):
  - `api/qbo/connect.ts` — the Connect/Reconnect URL. Redirects to Intuit's OAuth2 authorize screen (`appcenter.intuit.com/connect/oauth2`).
  - `api/qbo/callback.ts` — the OAuth2 **Redirect URI** (registered separately, under the app's Keys & OAuth tab, not the Compliance tab). Exchanges the `code` for access/refresh tokens and upserts them into `qbo_connections`.
  - `api/qbo/disconnect.ts` — the Disconnect URL. Revokes the refresh token with Intuit and deletes the local row.
  - `api/qbo/launch.ts` — the Launch URL. Looks up the incoming `realmId`; sends already-connected companies into the app, anyone else through `connect.ts` first.
  - `api/_lib/qbo.ts` — shared config (env-var-driven `QBO_CLIENT_ID`/`QBO_CLIENT_SECRET`/`QBO_REDIRECT_URI`), Intuit endpoint constants, and a `supabaseAdmin()` helper using the service-role key.
- **Data model:** new table `public.qbo_connections` (migration `202607210001_qbo_oauth_connections.sql`, applied to the live `wnsjzxotknadqvznnijw` project) — `realm_id` (PK), `access_token`, `refresh_token`, `expires_at`. RLS enabled with **zero policies** (deliberately — only the service-role key, which bypasses RLS, can touch this table; anon is denied by default). This table is never read by the browser client, only by the `api/qbo/*` serverless functions.
- **Env vars needed** (see `.env.example`): `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `SUPABASE_SERVICE_ROLE_KEY` — set in Vercel's project settings for Production, not just committed locally. Christiaan said to build this now for testing, without wiring up real Intuit keys yet — start against Intuit's **Sandbox** environment/keys, not Production, until NSA is actually ready to authorize her real company.
- **Not done yet:** no token refresh logic (access tokens expire in ~1hr; refresh tokens need a `grant_type=refresh_token` call before then), and no actual QBO API calls (create Estimate/Invoice/Customer) wired up — this scaffold only proves the connection can be established/stored/revoked. Building the real "push an NSA quote into QBO" logic is the next step once a sandbox (or real) connection is verified working.

---

## Things to actively avoid
- Don't design around QuickBooks Online patterns (webhooks, instant REST calls) for **Component 1** — that's Desktop, the constraints above are real and physical, not just current inconvenience.
- Don't let the OneDrive-synced `.QBW` file assumption go unchallenged if it resurfaces — flag it.
- Don't build any automatic "send to client" path without an explicit approval step in between, in either component.
- Don't assume QBD edition/Web Connector availability — confirm before deep SDK work.
- Don't connect to or write against NSA's real QuickBooks Online account without her explicit permission and Christiaan having real access — Component 2 is a simulated/standalone tool specifically to avoid this risk.
