// Generates the .qwc file you import into QuickBooks Web Connector.
// Usage:
//   node scripts/generate-qwc.mjs <endpointUrl> <username> [outFile]
// Example (local test):
//   node scripts/generate-qwc.mjs http://localhost:8080/qbwc an-jobsheets
// Example (Render):
//   node scripts/generate-qwc.mjs https://an-qbd-bridge.onrender.com/qbwc an-jobsheets
//
// OwnerID/FileID are stable GUIDs identifying this app to Web Connector; they
// are regenerated fresh each run unless you pass an existing .qwc's values via
// the QWC_OWNER_ID / QWC_FILE_ID env vars (keep them stable once QBWC has the app).

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const endpoint = process.argv[2];
const username = process.argv[3] ?? "an-jobsheets";
const outFile = process.argv[4] ?? "an-jobsheets.qwc";

if (!endpoint) {
  console.error("Usage: node scripts/generate-qwc.mjs <endpointUrl> <username> [outFile]");
  process.exit(1);
}

const isLocal = endpoint.startsWith("http://");
const ownerId = process.env.QWC_OWNER_ID ?? `{${randomUUID()}}`;
const fileId = process.env.QWC_FILE_ID ?? `{${randomUUID()}}`;

const qwc = `<?xml version="1.0"?>
<QBWCXML>
  <AppName>African Nomad Job Sheets</AppName>
  <AppID></AppID>
  <AppURL>${endpoint}</AppURL>
  <AppDescription>Syncs approved job sheets into QuickBooks Desktop as Estimates.</AppDescription>
  <AppSupport>${endpoint.replace(/\/qbwc$/, "/health")}</AppSupport>
  <UserName>${username}</UserName>
  <OwnerID>${ownerId}</OwnerID>
  <FileID>${fileId}</FileID>
  <QBType>QBFS</QBType>
  <Scheduler>
    <RunEveryNMinutes>5</RunEveryNMinutes>
  </Scheduler>${
    isLocal
      ? `
  <IsReadOnly>false</IsReadOnly>`
      : ""
  }
</QBWCXML>
`;

writeFileSync(outFile, qwc);
console.log(`Wrote ${outFile}`);
console.log(`  Endpoint: ${endpoint}`);
console.log(`  Username: ${username}`);
console.log(`  OwnerID:  ${ownerId}`);
console.log(`  FileID:   ${fileId}`);
if (isLocal) {
  console.log("\nNote: http:// (non-TLS) endpoints only work when QuickBooks and");
  console.log("the bridge run on the SAME machine. For a hosted bridge use https://.");
}
