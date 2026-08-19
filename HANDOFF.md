# Handoff — read this first in a new session

Status as of **2026-08-19 (second session)**. Working log, not finished
documentation — update it as things move. `AN_JOBSHEET_SYSTEM_CONTEXT.md` in
this repo root covers architecture/business rules; this file covers *where we
actually are now*.

**Three plans now exist for this repo — don't conflate their phase numbers:**
1. **Job Sheet Excel rebuild** (`C:\Users\User\.claude\plans\jiggly-growing-corbato.md`)
   — **the current active track.** Make the Job Sheet look and work like the
   team's real Excel job sheet, and fix the financial cascade to match it.
   Phases 1–3 are **done**; see below.
2. **Production-readiness plan** (`C:\Users\User\.claude\plans\sunny-juggling-rossum.md`)
   — Phases 0–2 done. **Phase 3 (Quote → Invoice / QuickBooks
   duplicate-protection) onwards is paused**, not abandoned; resume after the
   Job Sheet track lands.
3. **Sourcing-merge plan** (`C:\Users\User\.claude\plans\ok-so-you-knwoi-dreamy-engelbart.md`)
   — parked.

---

## 🔴 READ THIS FIRST: the Sibanye 2.5% reversed meaning

**The 2.5% is now a COST African Nomad carries, not a discount off the
client's invoice.** This reverses the 2026-07-20 decision that is still
described in older parts of this file and in two migrations.

- Sibanye is invoiced the **full subtotal plus VAT**. Nothing is deducted
  before VAT. No discount line appears on anything the mine sees.
- The 2.5% is calculated on the **VAT-INCLUSIVE** client total and sits inside
  company expenses.
- It comes off **before** the NSA/Tuscany 10% is worked out.

Why: the two real Excel workbooks in the repo root were parsed in full for the
first time. Both put "Sibanye 2.5%" as a supplier row computed on the incl-VAT
total, and the decoded cascade reproduces **both workbooks to the cent** —
including their hardcoded NSA-fee cells (`P14` = 5,290.83, `P27` = 3,674.54),
which only reconcile if the rebate is deducted before the 10%. The real NSA
paperwork agrees (`Invoice NSA06384`, `Quote 1291`: plain subtotal → VAT on the
full subtotal → total, no discount row), and every live `nsa_quotes` row already
has `discount_amount = 0`. Christiaan confirmed on 2026-08-19 after being shown
both worked totals side by side (R142,135.26 old vs **R145,779.75** new).

**Both Excel workbooks are pinned as test fixtures** in
`src/lib/feeCalculations.test.ts`. Those two tests are the acceptance criteria
for any future change to the cascade — if they pass, the app agrees with the
spreadsheet.

### ⚠️ The migration has NOT been applied to the live database yet

`supabase/migrations/202608190001_sibanye_rebate_as_cost.sql` is written,
reviewed and committed, but **not run against `wnsjzxotknadqvznnijw`**.
Christiaan needs to approve applying it. Until it runs:
- the app computes the new cascade, but stored rows still hold old numbers;
- a legacy draft opened in the UI shows its stale stored totals (e.g. the PPE
  draft shows VAT R52,905.94 where the new model gives R54,262.50).

What the migration does: comments the column, zeroes `discount_amount` in the
estimate/invoice/NSA-quote payloads, **restates every draft** job sheet, and
adds a reconciliation guard blocking invoicing of any pre-2026-08-19 sheet
whose stored total no longer reconciles.

**Live data checked 2026-08-19: all 12 job sheets are test data** ("bdbdb",
"Sync test job sheet — safe to delete", "Full System Test", "Torch Delivery
Test Job", "IDK"), and **not one has ever been invoiced** (`qbd_invoice_txn_id`
is null on every row). So no real money is affected by the reversal. The 8
approved/synced rows are deliberately *not* restated — they already sent
QuickBooks their old numbers.

---

## Job Sheet Excel rebuild — what landed

**Phase 1 (financial cascade) — DONE.** `feeCalculations.ts` rewritten to the
decoded Excel cascade. `SIBANYE_DISCOUNT_RATE` → `SIBANYE_REBATE_RATE`,
`sibanyeDiscountRateFor` → `sibanyeRebateRateFor`, `applyDiscountAndVat` →
`applyVat`, `sibanyeDiscount` → `sibanyeRebate`, new `totalCosts` field.
`MARGIN_TARGET_PCT` and `belowMarginTarget` **deleted** — Christiaan wanted the
real margin shown and every target/warning removed as clutter. Two Codex-found
fixes also landed: no fee is charged on a loss (`max(0, grossProfit)`), and
`round2` now rounds symmetrically on negatives.

**Phase 2 (the grid) — DONE.** `PairedLineItemsTable.tsx` and
`pairedLineItems.ts` deleted; replaced by `JobSheetLinesGrid.tsx` +
`jobSheetRows.ts`. Two independent column blocks side by side sharing row
numbers, contiguous cell borders, sticky header, row-number gutter, and real
Excel keyboard behaviour: Enter/arrows to move, Tab continues into a new row,
Ctrl+D fills down, and **paste of a tab-delimited block straight out of Excel**
(grows the sheet as needed). One client line can be backed by several supplier
lines; a client row owns supplier rows beneath it until the next client row
**or a blank row**. That blank-row terminator is load-bearing: without it the
Cup-a-Soup sheet's trailing unbilled costs pile onto the last Delivery line and
report it at -2420% margin. Rows that roll up are marked `↳` in the gutter.

**Phase 3 (internal print view) — DONE.** New
`JobSheetInternalDocument.tsx`, reachable from History via "Print job sheet".
Landscape A4, both column blocks, supplier names, fee lines, profit and margin.
Distinct from the client-facing `JobSheetDocument.tsx`, which is unchanged apart
from losing its discount row.

**Verified live in the browser, not just unit-tested.** The real Cup-a-Soup job
pasted into the grid produces Sub Total R126,765.00 · Vat R19,014.75 · Total
R145,779.75 · Total Expenses R93,694.17 · Profit R33,070.83 · Profit Margin
26.09% — every figure matching the workbook. Sibanye 2.5% renders R3,644.49 and
NSA 10% R3,674.54, both literal cell values from that sheet. 159 tests passing,
`tsc --noEmit` clean, `npm run build` clean.

**Still to verify:** a real save → reload round-trip against Supabase. The row
model's round-trip is unit-tested (including legacy shared-id rows and
NSA-quote conversions) but was not exercised against the live database, because
`job_sheets` has no anon DELETE policy and a test row could not be cleaned up.

---

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
