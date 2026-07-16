import "dotenv/config";
import { loadConfig, configProblems } from "./config";
import { SessionManager } from "./session";
import { SupabaseQueueStore } from "./supabaseStore";
import { createApp } from "./app";

const config = loadConfig();
const problems = configProblems(config);
if (problems.length > 0) {
  // Fail loud at startup rather than silently accepting QBWC connections that
  // can never do useful work.
  console.error("Bridge configuration incomplete:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const store = new SupabaseQueueStore(config);
const manager = new SessionManager(store, config);
const app = createApp(manager);

app.listen(config.port, () => {
  console.log(`AN QBD Bridge listening on :${config.port}`);
  console.log(`  WSDL:   GET  /qbwc?wsdl`);
  console.log(`  SOAP:   POST /qbwc`);
  console.log(`  Health: GET  /health`);
});
