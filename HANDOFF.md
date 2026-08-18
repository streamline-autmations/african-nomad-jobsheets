# Handoff — read this first in a new session

Status as of **2026-08-12**. This is a working log of an in-progress task, not
finished documentation — update it as things move rather than treating it as
a historical record. `AN_JOBSHEET_SYSTEM_CONTEXT.md` in this same repo root
covers the system's architecture and business rules; this file covers *where
we actually are right now*.

The full step-by-step plan being worked through lives at
`C:\Users\User\.claude\plans\ok-so-you-knwoi-dreamy-engelbart.md` (Claude
Code plan-mode file, survives across sessions on this machine).

---

## ⚠️ Nothing in this session is committed to git yet

`git status` shows 16 modified files and ~15 new files, all uncommitted, sitting
in the working tree. Do **not** assume anything below is "safe" just because
it's on disk — a `git stash` or a careless `git checkout` would lose it. If a
new session starts and the working tree is clean, that means someone
committed or discarded this work outside of a session — check before
assuming the plan below is still where things stand.

New files not yet committed (main ones): `src/lib/markup.ts`,
`src/lib/errors.ts`, `src/lib/jobSheetToNsaQuote.ts`,
`src/components/SpotBidCheck.tsx`, `src/lib/markup.test.ts`,
`src/lib/errors.test.ts`, `src/lib/nsaQuotes.test.ts`, and 9 new SQL
migrations under `supabase/migrations/20260806*` and `supabase/migrations/20260809*`.

---

## The actual goal (why any of this is happening)

Christiaan's bottleneck: a mine asks for something, and the same information
currently gets typed **three times** — once into the sourcing app, again into
a job sheet, again into the NSA-branded quote — with markup worked out by
hand in between. The whole project is collapsing that into one pass: source →
cost → quote, one enquiry, one entry.

Three systems involved:
1. **Job Sheet App** (`Desktop\Africannomad\Quicbooks`, this repo) — internal
   AN books, syncs to QuickBooks Desktop via the `bridge/` service.
2. **NSA Quote System** — same repo, different tabs — the client-facing
   document a mine actually sees (must be 100% NSA-branded, zero AN trace).
3. **Sourcing Engine** (`Desktop\Africannomad\Product-Sourcing\african-nomad-sourcing-engine`)
   — separate app, procurement/supplier search, being folded into this repo.

Locked-in decisions (do not re-litigate these without asking): QuickBooks
**Desktop** only, not Online (the QBO scaffold under `api/qbo/*` is dormant,
kept but not maintained). **One app** — sourcing UI moves into this app as
tabs. **One database** — sourcing's tables live in this project, not a
second Supabase project.

---

## What's DONE and verified working

**Phase 1 — speed inside the existing app.** All three parts built and
exercised live against the real database via Playwright:
- Markup column on job-sheet lines is now a typeable input (`src/lib/markup.ts`)
  — type a margin %, the client price fills in. Plus "apply to all lines."
- Spot-bid check (`src/components/SpotBidCheck.tsx`) — enter what the mine
  will pay, get the max you can spend with suppliers to hold a target margin.
- One-click **Job Sheet → NSA Quote** (`src/lib/jobSheetToNsaQuote.ts`) — the
  mirror of the existing NSA Quote → Job Sheet hand-off. Button lives in
  Approvals. Vendor number/address prefill from the last quote to that client.

**A real money bug was found and fixed during testing of the above.** The
Sibanye Stillwater 2.5% discount lived only on the internal job sheet, never
on the NSA document the mine actually receives — so AN's books were giving
away a discount the client was never actually billed less for. Measured gap
on one live job sheet: **R10,400.31**. Fixed: `nsa_quotes.discount_amount`
column added (`202608090002_nsa_quote_discount.sql`), `calculateNsaQuoteTotals()`
now applies it before VAT exactly like the job-sheet side, discount line
added to both the printed quote and the on-screen summary. Test in
`src/lib/nsaQuotes.test.ts` fails if this regresses.

**Two real quotes in the live database may already be affected by this bug**
— `NSA001` (Sibanye Stillwater E3) and `NSA-TEST-002` (Sibanye Stillwater
Kloof) were both raised at full price with no discount, before the fix.
**Never resolved: are these real paperwork that went to the mine, or test
data?** If real, Sibanye was overbilled ~R3,593.75 and ~R1,725.00
respectively and Christiaan needs to decide whether to credit it. Ask him.

**VAT excl./incl. fields on job-sheet lines** — both the client price and the
supplier cost now have two inputs (excl. VAT / incl. VAT), editable in either
direction, the way a spreadsheet works. `inclVat()`/`exclVat()` helpers added
to `src/lib/feeCalculations.ts`. This does not change what's stored — the
excl.-VAT number is still the one that drives margin, sheet totals, and the
QuickBooks sync. Screenshotted and confirmed both directions work.

**Bonus fix, unrelated to the plan:** every database error in the app
rendered as literally `"[object Object]"`, because the code assumed
supabase-js throws `Error` objects — it throws plain `PostgrestError` objects
instead. Fixed once in `src/lib/errors.ts`, replaced at 22 call sites across
8 components. No DB failure anywhere in the app was diagnosable before this.

**128 tests passing, `tsc --noEmit` clean**, as of last check this session.

**Sourcing database migration — DONE, but not for the reason planned.** The
original sourcing Supabase project (`mgqfoorchhbtlhvqscbl`) turned out to be
**deleted**, not just paused (see the Supabase-account saga below). Since
there was no data to migrate, the 7 sourcing-engine migrations were simply
replayed against *this* project (`wnsjzxotknadqvznnijw`) instead —
`supabase/migrations/202608060001..0007`. Verified live: 16 tables now exist
(9 job-sheet, 7 sourcing), zero name/type/function collisions, 18 suppliers +
3 saved products re-seeded, and the app's own anon key can read both halves.
**This is the database half of Phase 2 only** — the actual app merge
(sourcing UI moving into this repo's tabs, CSS, nav) has not been started.

---

## What's BLOCKED or needs Christiaan specifically

1. **Phase 0 — prove the QuickBooks Desktop bridge actually works.** Still
   the single biggest unretired risk in the whole project. The `bridge/`
   service has 27 unit tests and has **never been run against a real
   QuickBooks Desktop file.** Needs Christiaan: open QBD on a throwaway
   company file, install/configure QuickBooks Web Connector, approve a test
   job sheet, click Update in QBWC, confirm an Estimate + Bills actually
   appear. Steps are in `bridge/README.md`. Cannot be done by an agent —
   needs the real QuickBooks Desktop application and Web Connector running
   locally on Christiaan's machine.

2. **Sourcing app merge (rest of Phase 2) not started.** Database is ready;
   moving the actual sourcing UI/components into this repo's tabs (with CSS
   scoping, nav changes, etc.) has not begun.

3. **n8n workflows still point at the deleted sourcing project.** Both
   `pDSV9c8tRTR6eWpa` (intake) and `q8uIZPnIw7VeCudG` (feedback) on the
   shared Render n8n instance have `mgqfoorchhbtlhvqscbl`'s URL and
   service-role key baked into their node JSON. **Sourcing search will not
   work at all until these are repointed** at `wnsjzxotknadqvznnijw`. Must
   use in-place PUT (GET workflow → PUT same id with new `nodes`/`connections`)
   — delete/recreate orphans the webhook and 409s, per past experience on
   this same shared instance (100+ other businesses' live workflows on it).

4. **Delete the spare Supabase project `adpcujxbuhtrcwlfwigs`.** Christiaan
   created it mid-troubleshooting before we'd settled on "one database."
   It's empty and unused now.

5. **Resolve the two possibly-real Sibanye quotes** flagged above.

---

## The Supabase account saga (so it's not re-discovered from scratch)

Both Supabase projects went unreachable (NXDOMAIN) partway through this
session. After a long hunt across 4+ Google accounts and Supabase orgs:

- **`wnsjzxotknadqvznnijw`** (job sheets + NSA quotes + now sourcing too) —
  project display name **"QuickBooks"**, org **"streamlinebuilds-2's Org"**.
  Owning login: **`streamlinebuilds.2@gmail.com`** — NOT
  `streamline.automations.hq@gmail.com`, which is the git email and owns
  every *other* Streamline Automations Supabase project. This was paused,
  Christiaan restored it, all data intact.
- **`mgqfoorchhbtlhvqscbl`** (old standalone sourcing project) — confirmed
  **deleted**, not recoverable. Schema was preserved in the sourcing repo's
  migrations and has since been replayed into the QuickBooks project instead
  (see above).
- Full detail in memory file `supabase-accounts.md` and in
  `AN_JOBSHEET_SYSTEM_CONTEXT.md`'s "Which Supabase login owns these
  projects" section, and in the sourcing repo's own `CLAUDE.md`.

**Practical access:** a Supabase personal access token lives in this repo's
`.env.local` as `SUPABASE_ACCESS_TOKEN` (gitignored, not committed — but it
*was* pasted into this chat transcript at one point, so treat it as
semi-exposed and consider rotating). It was used for direct SQL queries via
the Management API (`https://api.supabase.com/v1/projects/{ref}/database/query`)
throughout this session, since the MCP OAuth flow for the `supabase-jobsheet`
server kept failing with `"Unrecognized client_id"` and was never resolved.

---

## Where to look for more detail

- `AN_JOBSHEET_SYSTEM_CONTEXT.md` (this repo root) — full architecture,
  business rules (fee cascade, NSA relationship, VAT), build history through
  2026-07-21. The canonical "drop this in as CLAUDE.md" doc.
- `C:\Users\User\.claude\plans\ok-so-you-knwoi-dreamy-engelbart.md` — the
  phased plan (Phase 0 through 4) with reasoning for each decision, merge
  mechanics for the sourcing app, and a running "known problems" list.
- Memory files under this project (auto-loaded each session):
  `jobsheet-phase-status.md`, `nsa-quote-system-plan.md`,
  `supabase-accounts.md`, `supabase-project.md`, `qbo-oauth-setup.md`.
- `bridge/README.md` — QuickBooks Desktop / Web Connector setup steps for
  Phase 0.
- Sourcing repo's own `CLAUDE.md` at
  `Desktop\Africannomad\Product-Sourcing\african-nomad-sourcing-engine\CLAUDE.md`.

## First things to do in a new session

1. `git status` — confirm the uncommitted work above is still there.
2. Ask Christiaan whether he wants this session's work **committed** — it
   never was, on purpose (never commit without being asked).
3. Ask about the two possibly-real Sibanye quotes (item 5 above) if not yet
   resolved.
4. Otherwise, pick up wherever the "BLOCKED" list above says to.
