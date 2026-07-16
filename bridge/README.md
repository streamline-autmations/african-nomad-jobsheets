# African Nomad — QBD Bridge (Phase 3)

The SOAP service QuickBooks Web Connector (QBWC) talks to. It reads approved
job sheets from Supabase's `qbd_sync_queue`, builds qbXML requests, and writes
the resulting QuickBooks TxnIDs / ListIDs back to Supabase.

This is **QuickBooks Desktop**, so there is no push-to-cloud path. QBWC runs on
the laptop next to QuickBooks and **polls** this bridge. The bridge can be
hosted anywhere QBWC can reach it over HTTPS (Render), or run on the same
laptop for local testing over HTTP.

Built and tested against **qbXML 13.0**, which every QuickBooks Desktop
Pro/Premier/Enterprise release since 2013 supports — including the current
trial — so moving from the trial to Pro requires no code change.

## What it does today

- **CustomerAdd** (with duplicate-name recovery via CustomerQuery) → mirrors the
  QBD ListID back into `customers` and links it onto the job sheet.
- **EstimateAdd** → writes the estimate TxnID onto the job sheet, flips it to
  `synced`.
- Auto-creates the service item (and a VAT line item) the estimates are booked
  under, if they don't already exist in the company file.
- **InvoiceAdd** (with `LinkedTxnID` back to the estimate) and **BillAdd** are
  built and unit-tested but **not yet exercised** — no app path queues those
  actions yet. Verify them against a real company file before relying on them.

Every write is idempotent-ish and gated: the bridge only ever acts on rows the
app already moved to `pending` via the approval flow. It never creates queue
rows itself.

## Local setup

```bash
cd bridge
npm install
cp .env.example .env      # then fill in the blanks (see below)
npm run build
npm test                  # 27 tests: builders, parsers, SOAP, full sessions
```

### Environment variables (`.env`)

| Var | What |
|---|---|
| `SUPABASE_URL` | `https://wnsjzxotknadqvznnijw.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service role** key (Dashboard → Project Settings → API). Not the anon key — the bridge must write to the queue, which anon can't. Keep it secret; it bypasses RLS. |
| `QBWC_USERNAME` / `QBWC_PASSWORD` | Credentials QBWC uses to authenticate to this bridge. Pick a strong password; you'll type it into QBWC once. |
| `QBD_ITEM_NAME` | Service item estimates are booked under (default `Job Sheet Line`). |
| `QBD_VAT_MODE` | `line` adds a VAT line item so the estimate total includes 15% VAT; `none` sends ex-VAT lines. |
| `QBD_VAT_ITEM_NAME` | VAT line item name (default `VAT @ 15%`). |
| `QBD_INCOME_ACCOUNT` | Income account for auto-created items — **must already exist** in the company file (default `Sales`). |
| `QBD_EXPENSE_ACCOUNT` | Expense account for BillAdd (later phase). |

## Testing against a real QuickBooks Desktop (trial)

> ⚠️ **Always test against a throwaway/sample company file first, never the live
> books.** In QuickBooks: File → New Company → or use one of the sample files.

The bridge and QuickBooks must be able to reach each other. Two options:

**A. Bridge on the same laptop as QuickBooks (simplest for first test).**
```bash
npm run build && npm start          # bridge on http://localhost:8080
npm run qwc -- http://localhost:8080/qbwc an-jobsheets
```
This writes `an-jobsheets.qwc`. QBWC accepts plain `http://` **only** when the
app URL is localhost on the same machine.

**B. Bridge hosted on Render (production shape).**
```bash
npm run qwc -- https://an-qbd-bridge.onrender.com/qbwc an-jobsheets
```

Then, on the laptop:
1. Open **QuickBooks Desktop** and the sample/test company file. Leave it open
   (ideally in multi-user mode so QBWC and humans don't lock each other out).
2. Open **QuickBooks Web Connector** (bundled with QBD; if missing, install it
   from Intuit). **File → Add an Application →** pick the generated `.qwc`.
3. First run, QuickBooks pops a certificate/authorisation dialog — choose
   **"Yes, always allow access even if QuickBooks is not running"** (or the
   running-only option for first tests).
4. Enter the `QBWC_PASSWORD` when QBWC prompts, and tick the app's checkbox.
5. Approve a job sheet in the app (creates `pending` rows), then click
   **Update Selected** in QBWC. Within a few seconds an Estimate should appear
   in QuickBooks, and the job sheet should flip to `synced` in the app.

### First-run checklist / gotchas
- The `QBD_INCOME_ACCOUNT` (default `Sales`) must exist in the company file, or
  the auto-item-create step fails. Rename the env var to match an account you
  have, e.g. a real income account.
- If QBWC shows an authentication error, the `QBWC_USERNAME`/`QBWC_PASSWORD` in
  the bridge env don't match what you typed into QBWC.
- If nothing syncs, check the bridge logs and the `qbd_sync_queue` rows — a
  `failed` row carries the QuickBooks error message in `error_message`.

## Deploying to Render

`render.yaml` defines the service (a sibling to the existing n8n service, not
bolted onto it). Point Render at this repo with **root directory `bridge`**,
then set the four secret env vars (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `QBWC_USERNAME`, `QBWC_PASSWORD`) in the Render
dashboard. Health check is `GET /health`.

## ⚠️ The `.QBW` file and OneDrive

Do **not** keep the live `.QBW` company file inside an actively-syncing OneDrive
folder while QuickBooks / the Web Connector is using it. OneDrive's file locking
fights QuickBooks' and is a well-known cause of company-file corruption. If you
want cross-laptop access, let OneDrive hold periodic `.QBB` **backups** instead,
and keep the live `.QBW` on local disk.

## Not in this phase

- **Phase 4 (Local Helper):** a small laptop script that watches Supabase and
  triggers QBWC's on-demand update so approvals sync in ~60–90s instead of
  waiting for QBWC's 5-minute timer. The `.qwc` above already sets a 5-minute
  scheduler as the fallback.
- Invoice/acceptance flow and supplier bills — schema and builders are ready,
  the app-side triggers are not built yet.
