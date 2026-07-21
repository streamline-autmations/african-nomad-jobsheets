import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/qbo";

/**
 * Launch URL for the Intuit app listing. Called when a user clicks this
 * app's tile from within QuickBooks Online (Apps menu), with ?realmId set.
 * Sends already-connected companies into the app; anyone else through the
 * connect flow first.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const realmId = String(req.query.realmId ?? "");

  if (realmId) {
    const supabase = supabaseAdmin();
    const { data } = await supabase
      .from("qbo_connections")
      .select("realm_id")
      .eq("realm_id", realmId)
      .maybeSingle();

    if (!data) {
      res.redirect(302, "/api/qbo/connect");
      return;
    }
  }

  res.redirect(302, "/");
}
