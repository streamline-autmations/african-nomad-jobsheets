import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/qbo.js";
import { listCustomers } from "../_lib/qboApi.js";

/**
 * Pulls the real Customer/Sub-customer list from the connected QuickBooks
 * Online company into public.nsa_qbo_customers, so the NSA Quote form can
 * offer a real Bill to/Ship to picker instead of free text. Never touches
 * vendor_number — that column is ours, not QBO's, and staff-entered values
 * must survive a re-sync.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST to sync." });
    return;
  }

  const supabase = supabaseAdmin();

  let customers;
  try {
    customers = await listCustomers();
  } catch (err) {
    console.error("sync-nsa-customers: listCustomers failed", err);
    res.status(502).json({
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (customers.length === 0) {
    res.status(200).json({ success: true, synced: 0 });
    return;
  }

  const rows = customers.map((c) => ({
    qbo_customer_id: c.id,
    display_name: c.displayName,
    parent_qbo_customer_id: c.parentId,
    is_sub_customer: c.isSubCustomer,
    bill_address: c.billAddress,
    ship_address: c.shipAddress,
    last_synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("nsa_qbo_customers")
    .upsert(rows, { onConflict: "qbo_customer_id" });

  if (error) {
    console.error("sync-nsa-customers: upsert failed", error);
    res.status(500).json({ error: error.message });
    return;
  }

  // Anything not returned by this sync — deactivated in QBO, or a leftover
  // from a previously-connected company (e.g. Sandbox rows still sitting
  // around after switching to Production) — is removed. Without this the
  // mirror only ever grows, and a stale row is indistinguishable from a real
  // one in the picker.
  const syncedIds = customers.map((c) => `"${c.id}"`).join(",");
  const { error: deleteError } = await supabase
    .from("nsa_qbo_customers")
    .delete()
    .not("qbo_customer_id", "in", `(${syncedIds})`);

  if (deleteError) {
    console.error("sync-nsa-customers: stale-row cleanup failed", deleteError);
  }

  res.status(200).json({ success: true, synced: rows.length });
}
