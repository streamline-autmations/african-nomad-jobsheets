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
  } catch (err) {
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
    throw new Error(`QBO token refresh failed${tid ? ` [intuit_tid: ${tid}]` : ""}: ${text}`);
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

async function buildLines(conn: QboConnection, lines: QboLine[], itemName: string) {
  const itemId = await findOrCreateServiceItem(conn, itemName);
  return lines.map((line) => ({
    DetailType: "SalesItemLineDetail",
    Amount: Math.round(line.qty * line.unitPrice * 100) / 100,
    Description: line.description,
    SalesItemLineDetail: {
      ItemRef: { value: itemId },
      Qty: line.qty,
      UnitPrice: line.unitPrice,
    },
  }));
}

interface QboDocResult {
  id: string;
  docNumber: string;
}

export async function createEstimate(input: {
  customerName: string;
  lines: QboLine[];
  itemName?: string;
}): Promise<QboDocResult> {
  const conn = await getActiveConnection();
  const customerId = await findOrCreateCustomer(conn, input.customerName);
  const Line = await buildLines(conn, input.lines, input.itemName ?? "Job Sheet Line");

  const result = await qboFetch(conn, "/estimate", {
    method: "POST",
    body: JSON.stringify({ CustomerRef: { value: customerId }, Line }),
  });
  return { id: result.Estimate.Id, docNumber: result.Estimate.DocNumber };
}

export async function createInvoice(input: {
  customerName: string;
  lines: QboLine[];
  itemName?: string;
}): Promise<QboDocResult> {
  const conn = await getActiveConnection();
  const customerId = await findOrCreateCustomer(conn, input.customerName);
  const Line = await buildLines(conn, input.lines, input.itemName ?? "Job Sheet Line");

  const result = await qboFetch(conn, "/invoice", {
    method: "POST",
    body: JSON.stringify({ CustomerRef: { value: customerId }, Line }),
  });
  return { id: result.Invoice.Id, docNumber: result.Invoice.DocNumber };
}
