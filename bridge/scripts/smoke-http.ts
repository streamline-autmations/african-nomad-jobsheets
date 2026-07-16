// Live HTTP smoke test: boots the real Express+SOAP app against an in-memory
// store and drives a full QBWC conversation over actual HTTP the way Web
// Connector would (fetch the WSDL, authenticate, loop send/receive, close).
// Run: npx tsx scripts/smoke-http.ts
import { AddressInfo } from "node:net";
import { createApp } from "../src/app";
import { SessionManager } from "../src/session";
import { loadConfig } from "../src/config";
import type { QueueRow } from "../src/types";
import { FakeQueueStore, makeQbdResponder } from "../src/testFakes";
import { escapeXml } from "../src/qbxml/xml";

const NS = "http://developer.intuit.com/";

function soap(method: string, params: Record<string, string>): string {
  const inner = Object.entries(params)
    .map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><${method} xmlns="${NS}">${inner}</${method}></soap:Body></soap:Envelope>`
  );
}

async function post(url: string, body: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body,
  });
  return res.text();
}

function pick(xml: string, tag: string): string {
  return new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? "";
}
function unescape(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function estimateRow(): QueueRow {
  return {
    id: "e1",
    job_sheet_id: "js1",
    action: "create_estimate",
    payload: {
      customer_name_raw: "Sibanye Stillwater",
      job_description: "Catering — site visit",
      client_lines: [{ id: "l1", description: "Catering", qty: 1, unitCost: 10000, lineTotal: 10000 }],
      client_subtotal: 10000,
      vat_amount: 1500,
      client_total: 11500,
    },
    status: "pending",
    qbd_txn_id: null,
    error_message: null,
    created_at: "2026-07-16T00:00:01Z",
    synced_at: null,
  };
}

function customerRow(): QueueRow {
  return {
    id: "c1",
    job_sheet_id: "js1",
    action: "create_customer",
    payload: { name: "Sibanye Stillwater" },
    status: "pending",
    qbd_txn_id: null,
    error_message: null,
    created_at: "2026-07-16T00:00:00Z",
    synced_at: null,
  };
}

async function main() {
  const config = loadConfig({
    QBWC_USERNAME: "an-jobsheets",
    QBWC_PASSWORD: "secret",
    SUPABASE_URL: "x",
    SUPABASE_SERVICE_ROLE_KEY: "x",
  });
  const store = new FakeQueueStore([customerRow(), estimateRow()]);
  const manager = new SessionManager(store, config);
  const app = createApp(manager);

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const endpoint = `${base}/qbwc`;

  const fail = (msg: string) => {
    console.error("SMOKE FAIL:", msg);
    server.close();
    process.exit(1);
  };

  // 1. WSDL reachable and well-formed enough to name the service.
  const wsdl = await (await fetch(`${endpoint}?wsdl`)).text();
  if (!wsdl.includes("QBWebConnectorSvc")) fail("WSDL missing service definition");
  console.log("✓ WSDL served");

  // 2. Health check.
  const health = await (await fetch(`${base}/health`)).json();
  if (!health.ok) fail("health check not ok");
  console.log("✓ /health ok");

  // 3. authenticate.
  const authXml = await post(endpoint, soap("authenticate", { strUserName: "an-jobsheets", strPassword: "secret" }));
  const tickets = [...authXml.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]);
  const ticket = tickets[0];
  const indicator = tickets[1] ?? "";
  if (!ticket || indicator !== "") fail(`authenticate returned [${tickets.join(", ")}]`);
  console.log("✓ authenticate → work available");

  // 4. send/receive loop with the fake QBD responder.
  const respond = makeQbdResponder();
  const seen: string[] = [];
  for (let i = 0; i < 50; i++) {
    const sendXml = await post(
      endpoint,
      soap("sendRequestXML", {
        ticket, strHCPResponse: "", strCompanyFileName: "test.QBW",
        qbXMLCountry: "US", qbXMLMajorVers: "13", qbXMLMinorVers: "0",
      }),
    );
    const request = unescape(pick(sendXml, "sendRequestXMLResult"));
    if (request === "") break;
    seen.push(/<(\w+Rq) requestID=/.exec(request)?.[1] ?? "?");
    const qbdResponse = respond(request);
    const recvXml = await post(
      endpoint,
      soap("receiveResponseXML", { ticket, response: qbdResponse, hresult: "", message: "" }),
    );
    const pct = Number(pick(recvXml, "receiveResponseXMLResult"));
    if (pct >= 100) break;
  }
  console.log(`✓ session ran requests: ${seen.join(" → ")}`);

  // 5. closeConnection.
  const closeXml = await post(endpoint, soap("closeConnection", { ticket }));
  const closeMsg = pick(closeXml, "closeConnectionResult");
  console.log(`✓ closeConnection → "${closeMsg}"`);

  // Assert end state.
  const js = store.jobSheets.get("js1")!;
  if (js.status !== "synced") fail(`job sheet status ${js.status}, expected synced`);
  if (!store.rows.every((r) => r.status === "confirmed")) fail("not all queue rows confirmed");
  console.log("✓ job sheet synced, all queue rows confirmed");

  console.log("\nSMOKE PASS — full QBWC session works over HTTP end to end.");
  server.close();
}

main();
