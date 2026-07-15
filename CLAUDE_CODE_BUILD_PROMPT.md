You are starting work on the **African Nomad Job Sheet Automation System**. Full context, architecture, schema, and business rules are in `AN_JOBSHEET_SYSTEM_CONTEXT.md` in this project root — read it in full before writing any code.

## What we're building, in one sentence
A web app that replaces a fragile Excel job-sheet process with a proper form that writes to Supabase, and a sync pipeline that gets approved job sheets into QuickBooks Desktop as Estimates (and later Invoices) as close to automatically as QuickBooks Desktop's architecture allows.

## Critical constraint before you design anything
This is **QuickBooks Desktop**, not QuickBooks Online. There is no REST API and no webhooks. The only integration path is **qbXML via QuickBooks Web Connector**, which can only be *polled from* the laptop running QuickBooks — never pushed to from the cloud. Read the "Why QBD changes the architecture" section of the context file carefully; do not default to QBO-style assumptions (instant API calls, webhook triggers) anywhere in this build.

## Build order — work through these phases in order, checking in with me between each

### Phase 1 — Supabase schema
Set up the tables specified in the context file (`companies`, `customers`, `common_expenses`, `job_sheets`, `qbd_sync_queue`, and a stub for `supplier_bills` for later). Use the existing Supabase project (`mgqfoorchhbtlhvqscbl`) — do not create a new project. Add appropriate RLS policies matching how the sourcing engine project already handles access (check that project's migrations if available for the pattern to follow).

### Phase 2 — Job Sheet App (React + Vite + TypeScript)
Follow the same conventions as the existing sourcing engine app: all Supabase access funnelled through a single `lib/` file, never direct component-to-Supabase calls, mobile + desktop responsive, deployed via Vercel with GitHub auto-deploy.

Required functionality:
- Company dropdown (African Nomad / Tuscany SA)
- Customer dropdown, sourced from the `customers` mirror table, with a "this customer doesn't exist yet" fallback that stages a `create_customer` action
- Client line items table (description, qty, unit cost → auto-calculated line total, subtotal, VAT at 15%, total incl VAT)
- Expense line items table (same shape, with description suggestions pulled from `common_expenses` but freely editable)
- Live fee calculation exactly matching the cascade rules in the context file (NSA 10%, Sibanye extra 2.5%, Tuscany silent partner 10%) — computed in application code, not just displayed, and covered by tests
- Margin display with a soft visual flag (not a hard block) if gross margin falls below ~20%
- Save writes a `draft` row to `job_sheets`
- An approval view where the owner can review a draft and approve it — approval is what actually creates a row in `qbd_sync_queue`, nothing before that point touches the sync queue

Write this with real component tests for the fee calculation logic specifically — that math must never silently drift, since it directly determines what goes to NSA, Sibanye, and the silent partner.

### Phase 3 — QBD Bridge
A SOAP-speaking service (host on Render, ideally alongside the existing n8n instance or as a clearly separate sibling service — your call, but keep it simple to deploy) implementing what QuickBooks Web Connector requires: `authenticate`, `sendRequestXML`, `receiveResponseXML`, `closeConnection`. It should read pending rows from `qbd_sync_queue`, construct the appropriate qbXML request (CustomerAdd, EstimateAdd, InvoiceAdd with a LinkedTxn back to the originating estimate, BillAdd), and on response, write the returned TxnID back to the corresponding `job_sheets`/`qbd_sync_queue` row and mark it confirmed.

Flag clearly if you need a QuickBooks Desktop sandbox/test file to validate against, or if this needs to be tested against Christiaan's real (or a trial) QBD installation — don't guess at qbXML correctness without a way to verify it.

### Phase 4 — Local Helper
A small script intended to run on the laptop alongside QuickBooks Desktop. Polls Supabase every 5–10 seconds for new `pending` rows in `qbd_sync_queue`, and when found, triggers Web Connector's on-demand update via command line rather than waiting for its internal timer. Keep this as lightweight and low-maintenance as possible — it's the one piece of this system that has to live locally rather than in the cloud, so simplicity and clear logging matter more than features.

## Ground rules for the whole build
- No path in this system sends anything to a client or posts anything financial without an explicit human approval step already recorded. If you're ever unsure whether an action needs a gate, add the gate.
- Don't build ahead of the phase list — if you see an obvious opportunity to also wire up supplier bill capture or job profitability while you're in there, flag it and ask rather than just doing it.
- If OneDrive-syncing the live `.QBW` file comes up in any config you're touching, raise the corruption risk explicitly rather than working around it silently.
- Match the sourcing engine's existing code conventions wherever this project sits alongside it, rather than introducing a different style.

Start with Phase 1. Show me the schema/migration before applying it.
