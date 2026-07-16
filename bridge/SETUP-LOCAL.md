# Running the QBD Bridge locally on a laptop (free, no Render)

The bridge runs on the **same laptop as QuickBooks Desktop** and Web Connector
talks to it over `http://localhost:8080`. This is the setup for both your test
laptop now and the main **accounting laptop** later — the steps are identical,
because the bridge always points Web Connector at `localhost`.

## One-time setup on a laptop

1. **Install Node.js** (LTS) from https://nodejs.org if it isn't already
   (`node --version` to check).

2. **Get the code.** Clone the private repo (you're logged into GitHub as
   `streamline-autmations`):
   ```
   git clone https://github.com/streamline-autmations/african-nomad-jobsheets.git
   cd african-nomad-jobsheets/bridge
   ```

3. **Create `bridge/.env`** by copying `.env.example` to `.env` and filling in:
   - `SUPABASE_SERVICE_ROLE_KEY` — from the Supabase dashboard
     (Project Settings → API → `service_role`). Secret; stays on this laptop.
   - `QBWC_PASSWORD` — the shared bridge password (same on every laptop).
   - `QBD_INCOME_ACCOUNT` — the income account name in THIS company file
     (default `Sales`).

4. **Build and start:**
   ```
   npm install
   npm run build
   npm start
   ```
   You should see `AN QBD Bridge listening on :8080`. Leave it running.
   Confirm in a browser: http://localhost:8080/health → `{"ok":true,...}`

5. **Add the app to Web Connector.** Open QuickBooks Web Connector →
   **File → Add an Application** → select `bridge/an-jobsheets-local.qwc`.
   Approve the certificate/authorisation prompt in QuickBooks, then enter the
   `QBWC_PASSWORD` when Web Connector asks. Tick the app's checkbox.

## Daily use

For a sync to happen, on that laptop you need, all at once:
- QuickBooks Desktop **open** (with the right company file), and
- The bridge **running** (`npm start`), and
- Web Connector **running**.

Then either wait for Web Connector's timer (set to 5 min) or click
**Update Selected** to sync immediately.

## Make the bridge auto-start (so you don't run `npm start` by hand)

The simplest reliable option on Windows — a Task Scheduler task at logon:

1. Build once: `npm run build`.
2. Open **Task Scheduler → Create Task**.
   - General: "AN QBD Bridge", "Run whether user is logged on or not".
   - Triggers: **At log on**.
   - Actions: Program `node`, Arguments `dist/server.js`, Start in
     `C:\path\to\african-nomad-jobsheets\bridge`.
3. Save. The bridge now starts with Windows.

(The Phase 4 local helper — which triggers Web Connector the instant a job
sheet is approved, instead of waiting for the 5-min timer — will build on this
same auto-start setup.)

## Moving to a different laptop

Repeat the one-time setup on the new machine. The only per-laptop values are in
`.env` (the service-role key, and the income account name if the company file
differs). The `.qwc` file works unchanged because it targets `localhost`.
