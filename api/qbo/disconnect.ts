import type { VercelRequest, VercelResponse } from "@vercel/node";
import { INTUIT_REVOKE_URL, intuitBasicAuthHeader, supabaseAdmin, htmlPage } from "../_lib/qbo.js";

/**
 * Disconnect URL for the Intuit app listing. Called when a company
 * disconnects the app from within QuickBooks Online (Apps > My Apps).
 * Revokes the stored refresh token with Intuit and removes our local row.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const realmId = String(req.query.realmId ?? "");
  const supabase = supabaseAdmin();

  if (realmId) {
    const { data } = await supabase
      .from("qbo_connections")
      .select("refresh_token")
      .eq("realm_id", realmId)
      .maybeSingle();

    if (data?.refresh_token) {
      await fetch(INTUIT_REVOKE_URL, {
        method: "POST",
        headers: {
          Authorization: intuitBasicAuthHeader(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ token: data.refresh_token }),
      }).catch(() => {
        // Best-effort revoke — proceed to remove our local row regardless,
        // since QuickBooks already considers the connection disconnected.
      });
    }

    await supabase.from("qbo_connections").delete().eq("realm_id", realmId);
  }

  res
    .status(200)
    .send(htmlPage("Disconnected", "<h1>Disconnected</h1><p>This QuickBooks connection has been removed.</p>"));
}
