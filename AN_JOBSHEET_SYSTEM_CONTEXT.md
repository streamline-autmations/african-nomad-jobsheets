# African Nomad — Job Sheet Automation System — Context

> Drop this file into the project root as `CLAUDE.md` or reference it at the start of any Claude Code session on this build.

---

## Business background

African Nomad is a South African multi-vertical company (mining sector supply, catering/food service, corporate gifting, event services). It operates through **two legal/accounting entities**:

- **African Nomad** — contracts work through NSA
- **Tuscany SA** — has a silent partner

Both currently book through **one shared QuickBooks Desktop (QBD)** company file (not QuickBooks Online). Confirm QBD edition (Pro/Premier/Enterprise) before assuming Web Connector/SDK support — this needs to be checked, don't assume Pro.

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
| Supabase project | `mgqfoorchhbtlhvqscbl` — same project as the sourcing engine, add new tables here |
| n8n | Hosted on Render at `dockerfile-1n82.onrender.com`, editor at `/home` — same instance handles all AN automation |
| Vercel | Existing account, auto-deploys from GitHub — Job Sheet App should follow the same deploy pattern as the sourcing engine |
| Sourcing engine | Separate but related app — a Job Sheet line item may eventually pull cost directly from a sourcing engine result. Keep this in mind but don't couple tightly yet. |
| Frontend stack | React 18 + Vite + TypeScript — match the sourcing engine's conventions exactly (component structure, Supabase access pattern via a single `lib/` file, never direct component-to-Supabase calls) |

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
  - `nsa_fee = gross_profit * 0.10` (always, since work is contracted through NSA)
  - `sibanye_fee = gross_profit * 0.025` **only if** Customer = "Sibanye Stillwater" (their 30-day payment term carries an extra 2.5% charge)
- **If Company = Tuscany SA:**
  - `tuscany_fee = gross_profit * 0.10` (goes to the silent partner)
- Fees are mutually exclusive by company — a job sheet is never both African Nomad and Tuscany SA.
- `total_fees = nsa_fee + sibanye_fee + tuscany_fee`
- `net_profit = gross_profit - total_fees`

This exact logic was already validated in an Excel bridge template (zero formula errors, tested with sample African Nomad + Sibanye Stillwater data). Match it precisely — this is not up for creative reinterpretation.

**Target margin:** informal target of 20%+ gross margin (not a hard rule, just a flag/indicator in the UI — do not block saving a job sheet that falls below it, just surface it visually).

---

## Human approval gates (enforce as real status transitions, not just UI text)

1. **Job sheet created** (status: `draft`) → owner reviews → **approves** (status: `approved`) → only then does anything get written to `qbd_sync_queue`
2. **Estimate created in QBD** → before sending to client, human approval required (this may live in QBD itself initially, or in the app later)
3. **Estimate accepted by client** → since QBD can't auto-detect acceptance, a human explicitly marks it "Accepted" in the app → this queues Invoice creation (linked to the original Estimate's `qbd_estimate_txn_id`)
4. **Invoice ready** → human approval before it's actually sent to the client

Do not build any path that skips these gates, even for "obviously fine" cases.

---

## Build order (phase 1 focus — confirmed with Christiaan)

1. **Supabase schema** — set up tables above
2. **Job Sheet App** (React/Vite/TS) — company dropdown, customer dropdown (reads from `customers` mirror table, with "create new" fallback), client/expense line item tables, live fee calculation matching the logic above, save → draft in `job_sheets`
3. **QBD Bridge** — the SOAP/qbXML service Web Connector talks to (this is the technically hardest part — budget real time for qbXML request/response format, and for testing against a real or sandbox QBD file)
4. **Local Helper** — the laptop-resident script polling Supabase and triggering Web Connector on-demand

Everything after this (supplier bill capture, job profitability rollups, cash flow, invoice chasing, monthly P&L) is a later phase — do not build ahead of this list without checking in.

---

## Things to actively avoid
- Don't design around QuickBooks Online patterns (webhooks, instant REST calls) — this is Desktop, the constraints above are real and physical, not just current inconvenience.
- Don't let the OneDrive-synced `.QBW` file assumption go unchallenged if it resurfaces — flag it.
- Don't build any automatic "send to client" path without an explicit approval step in between.
- Don't assume QBD edition/Web Connector availability — confirm before deep SDK work.
