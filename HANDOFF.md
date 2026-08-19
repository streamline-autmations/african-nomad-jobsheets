# Handoff — read this first in a new session

Status as of **2026-08-19**. Working log, not finished documentation — update
it as things move. `AN_JOBSHEET_SYSTEM_CONTEXT.md` in this repo root covers
architecture/business rules; this file covers *where we actually are now*.

**Two separate plans exist for this repo — don't conflate their phase
numbers:**
1. **Sourcing-merge plan** (`C:\Users\User\.claude\plans\ok-so-you-knwoi-dreamy-engelbart.md`)
   — folding the standalone Sourcing Engine app into this repo. **Parked**,
   not touched in the 2026-08-19 session — Christiaan explicitly said to
   ignore procurement/sourcing/dashboards/QBO/unrelated-UI this round.
2. **Production-readiness plan** (`C:\Users\User\.claude\plans\sunny-juggling-rossum.md`)
   — the **current active track**: make Job Sheet → NSA Quote → Approval →
   Invoice → QuickBooks Desktop solid and correct. This is what the rest of
   this file is about.

---

## Everything is committed and pushed — the tree is clean

Unlike every previous handoff note, there is **no uncommitted work** right
now. Three commits landed on `origin/master` this session:

- `e2836ae` — the *previous* sessions' work (markup input, VAT dual-entry,
  spot-bid check, Job Sheet→NSA Quote handoff, the original Sibanye
  NSA-document discount fix, `[object Object]` error-handling fix, sourcing
  schema replay). This had been sitting uncommitted since 2026-08-12 across
  multiple sessions — finally committed 2026-08-19 after re-confirming 128
  tests passing / `tsc` clean.
- `c566cc7` — this session's Phase 1+2 (see below).
- `84cd595` — a Codex-review follow-up fix to `c566cc7`'s migration.

Repo: `https://github.com/streamline-autmations/african-nomad-jobsheets`.
Deployed to **Vercel** (confirmed by `vercel.json` + `@vercel/node` dep, not
Netlify) at `https://african-nomad-jobsheets.vercel.app` — found in
`n8n-workflows/nsa-quote-to-qbo.json`, **not** verified live. **Which Vercel
account owns it is unknown** — it is not under the Vercel team this session's
MCP connector has access to (`christiaan-steffens-projects-ebb06fe4`), which
matches the Supabase saga's pattern (AN's stuff lives under
`streamlinebuilds.2@gmail.com`, a separate login) but that's an unconfirmed
guess, not a fact. Ask Christiaan which account/team it's under before
assuming you can check its deploy status.

---

## Production-readiness plan — where it stands

Full plan, current-state findings, and every risk found (22 numbered items)
live in `C:\Users\User\.claude\plans\sunny-juggling-rossum.md` — read that
before continuing, it's the source of truth. Summary:

**Phase 0 (git safety) — DONE.** See commits above.

**Phase 1 (financial-correctness fixes) — DONE**, in `c566cc7`:
- Per-line margin repricing (`markup.ts`, `PairedLineItemsTable.tsx`) is now
  Sibanye-discount-aware — previously a line "priced to 20%" on a
  Sibanye/African Nomad job actually netted ~17.95% once the sheet-level 2.5%
  discount came off. New `discountRate` param threaded through
  `clientUnitCostForMargin`/`repriceRowToMargin`/`marginPctFromTotals`, fed by
  a new `sibanyeDiscountRateFor()` in `feeCalculations.ts`.
- Extracted the discount→VAT sequencing into one shared
  `applyDiscountAndVat()` in `feeCalculations.ts`, called by both
  `calculateJobSheetFinancials` and `nsaQuotes.calculateNsaQuoteTotals` —
  previously two hand-mirrored copies of the same math, kept in sync only by
  a test.

**Phase 2 (Job Sheet ↔ NSA Quote handoff hardening) — DONE**, in `c566cc7`
+ `84cd595`:
- Both hand-off directions were a plain client-side insert + separate update,
  no transaction, no row lock, no re-check the link was still null. Replaced
  with two atomic Postgres RPCs (`create_nsa_quote_from_job_sheet`,
  `create_job_sheet_from_nsa_quote`), mirroring `approve_job_sheet`'s
  `SELECT...FOR UPDATE` pattern. Migration:
  `202608180001_atomic_job_sheet_nsa_quote_handoff.sql`.
- The forward RPC takes **no financial numbers as arguments** — reads
  subtotal/discount/VAT/total straight off the job-sheet row it just locked,
  so a draft edited in another tab can't produce a quote whose lines and
  totals disagree (a real bug a Codex review caught before this shipped).
- Partial unique indexes on both link columns as a DB-level backstop.
  Backfilled 4 legacy one-sided links (old two-step code only ever set one
  side) — **this included NSA001 and NSA-TEST-002**, both now correctly
  linked both ways.
- Server-side Tuscany SA gating (NSA quotes only from African Nomad jobs) —
  previously UI-only.
- Fixed a stale-response race in the async vendor/address prefill lookup in
  `ApprovalView.tsx`, and a stale-render bug in the linked-quote warning.
- Added an inline warning when editing a job sheet whose NSA quote has
  already moved past `draft`.
- Follow-up migration `202608180002_reconcile_legacy_job_sheet_nsa_quote_links.sql`
  (from a second Codex review pass): the first migration's backfill only
  repaired one direction; this closes the other, plus adds a pre-flight
  duplicate-conflict check. Verified live: no conflicts exist today, this is
  defensive for future drift/a fresh restore.
- **Every RPC was verified live against the real database** (happy path,
  re-entry rejection, status/company gating, unique-index backstop) with all
  test rows cleaned up afterward — not just unit-tested.

**NSA001 / NSA-TEST-002 — resolved.** Christiaan confirmed both were test
data, not real invoices sent to Sibanye. No financial correction made or
needed. (Evidence that led here: `NSA-TEST-002`'s job sheet literally reads
`"Full System Test - Kloof Delivery"`; `NSA001` had placeholder-style
`vendor_number: "999-999-9"` / `po_number: "PO-777-777-7"`; both job sheets
were never approved or synced to QuickBooks.)

**Phase 3 (Quote → Invoice / QuickBooks duplicate-protection) — NOT
STARTED.** This is next. From the plan:
- Add a partial unique index on `qbd_sync_queue` preventing two
  `pending`/`sent` rows for the same `(job_sheet_id, action)`.
- Add an atomic "invoice requested" gate before `convert_job_sheet_to_invoice`
  queues its row (currently no state recorded before insert — two rapid
  calls in the confirmation-pending window can insert two invoice rows).
- Give the bridge's Estimate/Invoice/Bill builders a stable idempotency key
  (e.g. the `qbd_sync_queue` row id as `RefNumber`), and a check-before-
  resubmit query path, so the bridge's `requeueStaleSent(15min)` can't create
  a genuine duplicate transaction in QuickBooks when a confirmation response
  gets lost after QBD already succeeded. **This is the real "must not create
  another invoice" fix** — everything else is process-gating around it.
- **Disable the live "Push to QuickBooks Online" button** in
  `NsaQuoteList.tsx` — Christiaan pre-approved this. It's fully wired, zero
  idempotency, and directly contradicts the locked QBD-only decision. Code
  stays (dormant), just make it unclickable.

**Phase 4 (QBD bridge fixes ahead of a real test) — NOT STARTED.**
- `buildInvoiceAdd` sends both `LinkToTxnID` and explicit `InvoiceLineAdd`
  lines together — the code's own comment flags this as unverified; per
  QBD's documented `LinkToTxnID` auto-copy behavior this is likely wrong.
  **Christiaan pre-approved dropping the explicit lines** when linking to an
  Estimate — verify on the first live Invoice test.
- Add the missing successful `invoice_add` end-to-end session test (only
  qbXML-shape and failure-path tests exist today).
- Fix three README inaccuracies: test count says 27, actual is 44+; calls the
  invoice-link field `LinkedTxnID`, correct name is `LinkToTxnID`; env-var
  table is missing `QBD_DISCOUNT_ITEM_NAME`/`QBD_DEFAULT_VENDOR_NAME`.

**Full QBD readiness assessment** (from a dedicated Explore-agent inspection
this session): **EstimateAdd is ready** for a first real test (full
success+failure coverage, the one builder with a live app code path today).
**BillAdd is ready** (full coverage, never run live — normal first-
integration unknowns only). **InvoiceAdd is not ready** — no app path even
produces `create_invoice` rows yet, no successful-path test exists, and the
`LinkToTxnID` conflict above needs fixing first. Test Estimate + Bill live
before attempting Invoice.

**Phase 5 (Christiaan's manual QuickBooks Desktop test) — blocked on him,
needs Phase 4 done first.** Exact procedure is written out in the plan file
section 5 (open QBD on a throwaway company file, generate the `.qwc`, Web
Connector setup, what success/failure looks like, what to send back).

**Phase 6 (full acceptance-test dry run) — not started**, depends on 3–5.

---

## Loose ends, not part of the production-readiness plan

- **Original Excel Job Sheet template — found mid-session, not yet
  reconciled against the app.** Two real files landed in the repo root
  during the 2026-08-19 session: `Jobsheet 2pc travel bag + backpack.xlsx`
  and `Jobsheet Rowland Cup a Soup project.xlsx` (both untracked, not
  committed — same treatment as the other loose reference PDFs/images at
  repo root). A quick unzip-and-grep of their shared strings reveals a
  **much richer cost-sheet structure than the app currently models**:
  separate "CLIENT CE" vs "SUPPLIER ITEMS" sections, promoter/crew/days/
  hours dimensions, a "Management Fee" line, and — the one that actually
  matters — **`"Profit Margin (Must stay above 40%)"`**, not the app's
  `MARGIN_TARGET_PCT = 20` in `feeCalculations.ts`. Both files share
  identical sheet structure/tabs (`ChaseImport`, `WorkTypeList`, `Setup`,
  `TaskList`, etc. — looks like an export from a BTL/promotions job-costing
  tool called "Chase", not something built in-house), and are full of real
  line items from what reads as event/activation/promoter work (MCs, crew,
  branded surfboards, bean-bag hire), which may be a different job type or
  business line than the mining corporate-gifting work `job_sheets` handles
  today. **Not yet properly parsed for real numbers, and no code changed
  based on this** — the 20%-vs-40% margin-target discrepancy in particular
  needs Christiaan's input before anything is concluded: is `MARGIN_TARGET_PCT`
  wrong, is this a different/legacy business line, or something else
  entirely? Worth a proper structured read (not ad-hoc unzip/grep) if picked
  back up.
- **Which Vercel account owns the deployment** — see above, unresolved.
- **Sourcing app merge** (the *other* plan) — not started, not touched this
  session, stays parked until Christiaan asks for it.
- **n8n workflows still point at the deleted sourcing Supabase project**
  (`mgqfoorchhbtlhvqscbl`) — unrelated to the production-readiness track,
  carried over from before.
- **Delete the empty spare Supabase project `adpcujxbuhtrcwlfwigs`** —
  carried over from before, still not done.

---

## Practical notes for whoever picks this up

- **Supabase access**: MCP OAuth for the `supabase-jobsheet` server is still
  broken (`"Unrecognized client_id"`). Direct SQL via the Management API
  (`https://api.supabase.com/v1/projects/wnsjzxotknadqvznnijw/database/query`,
  token in `.env.local`'s `SUPABASE_ACCESS_TOKEN`) is the practical path —
  used extensively this session to apply and live-verify migrations. That
  token was pasted into a chat transcript at some point in an earlier
  session; treat as semi-exposed.
- **Codex CLI** (`codex`, v0.146.0, confirmed installed/working) — used
  throughout this session as an independent second-opinion reviewer before
  committing financially-critical code, per the `codex-router` skill, and it
  caught three real bugs before they shipped. One CLI quirk worth knowing:
  `codex exec review --uncommitted` **cannot** take a custom focus-prompt
  argument in this version (errors despite the `--help` text implying it's
  allowed) — run it with no prompt for default review criteria, or use plain
  `codex exec -s read-only "<prompt>"` (not the `review` subcommand) when you
  need a focused ask.
- `AN_JOBSHEET_SYSTEM_CONTEXT.md` — architecture/business-rules doc, still
  the canonical reference for the fee cascade, NSA relationship, VAT rules.
- Memory files under this project (auto-loaded each session) — check
  `MEMORY.md`'s index for the current list; several were updated 2026-08-19.

## First things to do in a new session

1. `git status` — should be clean. If not, something changed outside a
   tracked session; investigate before assuming this file is accurate.
2. Read `C:\Users\User\.claude\plans\sunny-juggling-rossum.md` in full.
3. Pick up at Phase 3 (Quote → Invoice / QuickBooks duplicate-protection)
   unless Christiaan redirects.
