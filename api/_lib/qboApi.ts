import { INTUIT_TOKEN_URL, intuitBasicAuthHeader, supabaseAdmin } from "./qbo.js";

// Sandbox vs production only changes which QBO API host we call — same
// OAuth flow, same code path either way. Defaults to sandbox since that's
// what we're testing against; flip via QBO_API_ENVIRONMENT=production once
// a real company is actually connected.
const QBO_API_BASE =
  process.env.QBO_API_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

interface QboConnection {
  realm_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One retry, and only for failures worth retrying: a network-level throw, or
 * a 5xx from Intuit's side. A 4xx (bad request, expired/invalid token,
 * invalid_grant, etc.) means retrying the exact same request will fail the
 * exact same way, so those are returned immediately for the caller to handle.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, init);
    if (res.status >= 500) {
      await sleep(400);
      return fetch(url, init);
    }
    return res;
  } catch {
    // A network-level throw (DNS, socket reset, TLS) carries nothing the
    // caller can act on that the retry's own outcome won't, so it is not
    // rebound — if the retry also throws, that error propagates.
    await sleep(400);
    return fetch(url, init);
  }
}

async function refreshAccessToken(conn: QboConnection): Promise<QboConnection> {
  const res = await fetchWithRetry(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: intuitBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
    }),
  });
  if (!res.ok) {
    const tid = res.headers.get("intuit_tid");
    const text = await res.text();
    console.error("QBO token refresh failed", { intuit_tid: tid, body: text });
    // A refresh call fails when the refresh token itself is dead — expired
    // (they last ~100 days) or revoked (disconnected from within QuickBooks).
    // Retrying won't fix that; the only way forward is reconnecting, so the
    // message says so explicitly rather than surfacing Intuit's raw error.
    throw new Error(
      `Your QuickBooks connection has expired or was disconnected — reconnect at /api/qbo/connect.${tid ? ` [intuit_tid: ${tid}]` : ""}`,
    );
  }
  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const supabase = supabaseAdmin();
  await supabase
    .from("qbo_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("realm_id", conn.realm_id);

  return { ...conn, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: expiresAt };
}

/** Picks the most recently connected company. Fine for a single-company demo/test setup. */
async function getActiveConnection(): Promise<QboConnection> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("qbo_connections")
    .select("realm_id, access_token, refresh_token, expires_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("No QuickBooks connection found — connect via /api/qbo/connect first.");
  }

  if (new Date(data.expires_at).getTime() - Date.now() < 2 * 60 * 1000) {
    return refreshAccessToken(data);
  }
  return data;
}

// QBO's REST responses are heterogeneous per-entity payloads; callers know
// the shape they asked for, so this deliberately returns `any` rather than
// threading a generic through every query/create call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function qboFetch(conn: QboConnection, path: string, init?: RequestInit): Promise<any> {
  const res = await fetchWithRetry(`${QBO_API_BASE}/v3/company/${conn.realm_id}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    // intuit_tid identifies this exact request to Intuit's own support team —
    // capturing it is the single most useful thing for them to troubleshoot
    // an error with, so it goes in both the log and the thrown message.
    const tid = res.headers.get("intuit_tid");
    const text = await res.text();
    console.error("QBO API error", { path, intuit_tid: tid, body: text });
    throw new Error(`QBO API error (${path})${tid ? ` [intuit_tid: ${tid}]` : ""}: ${text}`);
  }
  return res.json();
}

function escapeQboString(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function findOrCreateCustomer(conn: QboConnection, displayName: string): Promise<string> {
  const query = `select Id from Customer where DisplayName = '${escapeQboString(displayName)}'`;
  const result = await qboFetch(conn, `/query?query=${encodeURIComponent(query)}`);
  const existing = result.QueryResponse?.Customer?.[0];
  if (existing) return existing.Id as string;

  const created = await qboFetch(conn, "/customer", {
    method: "POST",
    body: JSON.stringify({ DisplayName: displayName }),
  });
  return created.Customer.Id as string;
}

async function findOrCreateServiceItem(conn: QboConnection, itemName: string): Promise<string> {
  const query = `select Id from Item where Name = '${escapeQboString(itemName)}'`;
  const result = await qboFetch(conn, `/query?query=${encodeURIComponent(query)}`);
  const existing = result.QueryResponse?.Item?.[0];
  if (existing) return existing.Id as string;

  const accounts = await qboFetch(
    conn,
    `/query?query=${encodeURIComponent("select Id from Account where AccountType = 'Income'")}`,
  );
  const incomeAccountId = accounts.QueryResponse?.Account?.[0]?.Id;
  if (!incomeAccountId) {
    throw new Error("No Income account found in the QuickBooks company to attach the item to.");
  }

  const created = await qboFetch(conn, "/item", {
    method: "POST",
    body: JSON.stringify({
      Name: itemName,
      Type: "Service",
      IncomeAccountRef: { value: incomeAccountId },
    }),
  });
  return created.Item.Id as string;
}

export interface QboCustomerRecord {
  id: string;
  displayName: string;
  parentId: string | null;
  isSubCustomer: boolean;
  billAddress: string;
  shipAddress: string;
}

// QBO omits address sub-fields inconsistently per entity, so this reads
// whatever is present rather than asserting a shape Intuit does not guarantee.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatQboAddress(addr: any): string {
  if (!addr) return "";
  return [addr.Line1, addr.Line2, addr.City, addr.CountrySubDivisionCode, addr.PostalCode]
    .filter(Boolean)
    .join(", ");
}

/**
 * Every Customer in the connected QBO company, sub-customers (Jobs) included
 * — a mine site like "Sibanye Rustenburg Mine Pty Ltd:Saffy Shaft" is a
 * top-level customer with a sub-customer beneath it. Paginates in batches of
 * 100 since QBO caps a single query's MAXRESULTS.
 */
export async function listCustomers(): Promise<QboCustomerRecord[]> {
  const conn = await getActiveConnection();
  const records: QboCustomerRecord[] = [];
  const pageSize = 100;
  let startPosition = 1;

  for (;;) {
    // QBO's query language only allows simple/queryable fields to be named
    // in SELECT — compound properties like BillAddr/ShipAddr/ParentRef
    // ("Property BillAddr not found for Entity Customer") are only returned
    // via `select *`, which fetches the full object.
    const query =
      `select * from Customer ` +
      `where Active = true startposition ${startPosition} maxresults ${pageSize}`;
    const result = await qboFetch(conn, `/query?query=${encodeURIComponent(query)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw QBO Customer payloads, narrowed field by field just below
    const page = (result.QueryResponse?.Customer ?? []) as any[];

    for (const c of page) {
      records.push({
        id: c.Id as string,
        displayName: c.DisplayName as string,
        parentId: c.ParentRef?.value ?? null,
        isSubCustomer: Boolean(c.Job),
        billAddress: formatQboAddress(c.BillAddr),
        shipAddress: formatQboAddress(c.ShipAddr),
      });
    }

    if (page.length < pageSize) break;
    startPosition += pageSize;
  }

  return records;
}

export interface QboLine {
  description: string;
  qty: number;
  unitPrice: number;
}

/**
 * Companies outside the US (this one is South African) don't use QBO's
 * "Automated Sales Tax" special codes ("TAX"/"NON") — they have their own
 * TaxCode records, and a transaction with Sales Tax enabled on the company
 * will be rejected ("Make sure all your transactions have a sales tax rate
 * before you save") if no line carries one. There's no field marking "the"
 * default taxable code, and matching by name alone is unreliable — this
 * company's "Standard Rate" code turned out to still carry South Africa's
 * pre-2018 14% rate rather than the current 15% VAT, so this instead
 * resolves each TaxCode's actual TaxRate percentage and picks the one that's
 * really 15%, falling back to name-matching only if no code has that exact
 * rate. Line Amounts we send are already VAT-exclusive (feeCalculations.ts
 * adds VAT as a separate cascade step, never per-line), which matches QBO's
 * default TaxExcluded calculation — so this doesn't double up on VAT, it
 * lets QBO's own copy of the transaction correctly show tax at all.
 */
const SA_VAT_RATE = 15;
let cachedTaxCodeId: string | null | undefined;

async function findDefaultTaxCodeId(conn: QboConnection): Promise<string | null> {
  if (cachedTaxCodeId !== undefined) return cachedTaxCodeId;

  const codesResult = await qboFetch(
    conn,
    `/query?query=${encodeURIComponent("select * from TaxCode where Active = true")}`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw QBO TaxCode payloads
  const codes = (codesResult.QueryResponse?.TaxCode ?? []) as any[];
  if (codes.length === 0) {
    cachedTaxCodeId = null;
    return null;
  }

  const ratesResult = await qboFetch(
    conn,
    `/query?query=${encodeURIComponent("select * from TaxRate where Active = true")}`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw QBO TaxRate payloads
  const rates = (ratesResult.QueryResponse?.TaxRate ?? []) as any[];
  const rateValueById = new Map(rates.map((r) => [r.Id as string, Number(r.RateValue)]));

  const byActualRate = codes.find((c) => {
    const taxRateId = c.SalesTaxRateList?.TaxRateDetail?.[0]?.TaxRateRef?.value as string | undefined;
    const rateValue = taxRateId ? rateValueById.get(taxRateId) : undefined;
    return rateValue === SA_VAT_RATE;
  });

  const standard = codes.find((c) => /standard/i.test(c.Name ?? ""));
  cachedTaxCodeId = (byActualRate ?? standard ?? codes[0]).Id as string;
  return cachedTaxCodeId;
}

async function buildLines(conn: QboConnection, lines: QboLine[], itemName: string) {
  const itemId = await findOrCreateServiceItem(conn, itemName);
  const taxCodeId = await findDefaultTaxCodeId(conn);
  return lines.map((line) => ({
    DetailType: "SalesItemLineDetail",
    Amount: Math.round(line.qty * line.unitPrice * 100) / 100,
    Description: line.description,
    SalesItemLineDetail: {
      ItemRef: { value: itemId },
      Qty: line.qty,
      UnitPrice: line.unitPrice,
      ...(taxCodeId ? { TaxCodeRef: { value: taxCodeId } } : {}),
    },
  }));
}

interface QboDocResult {
  id: string;
  docNumber: string;
}

/**
 * This company has Custom Transaction Numbers on (real documents mix
 * formats — plain "1426" for quotes, prefixed "NSA06392" for invoices),
 * which is exactly the setting under which Intuit's own docs say QBO will
 * NOT auto-assign a DocNumber if we don't supply one — confirmed live: a
 * real push came back with DocNumber entirely absent. So the number has to
 * come from us: read the most recently created document of the same type
 * (ordering by Id, which increments with creation regardless of what
 * DocNumber was typed) and increment its trailing digits, preserving
 * whatever prefix and zero-padding it had.
 *
 * Race note: two pushes landing at nearly the same instant could compute the
 * same next number. Low-volume single-operator use makes this acceptable for
 * now — a collision surfaces as a clear QBO duplicate-number error to retry,
 * not a silent one.
 */
function nextDocNumber(lastNumber: string | null | undefined): string | null {
  if (!lastNumber) return null;
  const match = lastNumber.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  const [, prefix, digits] = match;
  const next = (parseInt(digits, 10) + 1).toString().padStart(digits.length, "0");
  return `${prefix}${next}`;
}

async function findNextDocNumber(
  conn: QboConnection,
  entity: "Estimate" | "Invoice",
): Promise<string | null> {
  // Looks past the single most recent record on purpose — a document created
  // before this numbering logic existed (or one some other integration
  // created) can have a blank DocNumber, and basing "next" off a blank would
  // compute nothing. Walks back through recent history for the last one that
  // actually has a number.
  const query = `select * from ${entity} orderby Id desc maxresults 25`;
  const result = await qboFetch(conn, `/query?query=${encodeURIComponent(query)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw QBO Estimate/Invoice payloads
  const records = (result.QueryResponse?.[entity] ?? []) as any[];
  const lastWithNumber = records.find((r) => r.DocNumber);
  return nextDocNumber(lastWithNumber?.DocNumber);
}

export async function createEstimate(input: {
  customerName: string;
  /** The real QBO Customer.Id, when known (e.g. picked from the synced
   * nsa_qbo_customers mirror) — skips the name-based find-or-create lookup,
   * which matters once two different customers could share a display name. */
  customerId?: string;
  lines: QboLine[];
  itemName?: string;
}): Promise<QboDocResult> {
  const conn = await getActiveConnection();
  const customerId = input.customerId ?? (await findOrCreateCustomer(conn, input.customerName));
  const Line = await buildLines(conn, input.lines, input.itemName ?? "Job Sheet Line");
  const docNumber = await findNextDocNumber(conn, "Estimate");

  const result = await qboFetch(conn, "/estimate", {
    method: "POST",
    body: JSON.stringify({
      CustomerRef: { value: customerId },
      Line,
      ...(docNumber ? { DocNumber: docNumber } : {}),
    }),
  });
  return { id: result.Estimate.Id, docNumber: result.Estimate.DocNumber };
}

export async function createInvoice(input: {
  customerName: string;
  customerId?: string;
  lines: QboLine[];
  itemName?: string;
}): Promise<QboDocResult> {
  const conn = await getActiveConnection();
  const customerId = input.customerId ?? (await findOrCreateCustomer(conn, input.customerName));
  const Line = await buildLines(conn, input.lines, input.itemName ?? "Job Sheet Line");
  const docNumber = await findNextDocNumber(conn, "Invoice");

  const result = await qboFetch(conn, "/invoice", {
    method: "POST",
    body: JSON.stringify({
      CustomerRef: { value: customerId },
      Line,
      ...(docNumber ? { DocNumber: docNumber } : {}),
    }),
  });
  return { id: result.Invoice.Id, docNumber: result.Invoice.DocNumber };
}
