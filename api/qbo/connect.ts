import type { VercelRequest, VercelResponse } from "@vercel/node";
import { INTUIT_AUTHORIZE_URL, QBO_CLIENT_ID, QBO_REDIRECT_URI, QBO_SCOPE, htmlPage } from "../_lib/qbo";

/**
 * Connect/Reconnect URL for the Intuit app listing. Starts the OAuth2
 * authorization-code flow — redirects to Intuit's consent screen. Intuit
 * calls back to api/qbo/callback with the resulting code + realmId.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!QBO_CLIENT_ID || !QBO_REDIRECT_URI) {
    res
      .status(500)
      .send(
        htmlPage(
          "QuickBooks connection not configured",
          "<h1>Not configured yet</h1><p>QBO_CLIENT_ID / QBO_REDIRECT_URI are not set in this environment.</p>",
        ),
      );
    return;
  }

  const state = Math.random().toString(36).slice(2);
  const authorizeUrl = new URL(INTUIT_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", QBO_CLIENT_ID);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", QBO_SCOPE);
  authorizeUrl.searchParams.set("redirect_uri", QBO_REDIRECT_URI);
  authorizeUrl.searchParams.set("state", state);

  res.redirect(302, authorizeUrl.toString());
}
