import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  INTUIT_TOKEN_URL,
  QBO_REDIRECT_URI,
  intuitBasicAuthHeader,
  supabaseAdmin,
  htmlPage,
} from "../_lib/qbo.js";

/**
 * OAuth2 redirect URI (set under Keys & OAuth in the Intuit app, not the
 * Compliance tab). Intuit redirects here with ?code&realmId after the user
 * approves the connection. Exchanges the code for tokens and stores them.
 */
// Clears the one-time state cookie regardless of outcome — a stale value
// left behind after a failed or abandoned attempt should never be checked
// against a later, unrelated connect attempt.
function clearStateCookie(res: VercelResponse) {
  res.setHeader("Set-Cookie", "qbo_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/qbo; Max-Age=0");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, realmId, error, state } = req.query;

  if (error) {
    clearStateCookie(res);
    res.status(400).send(htmlPage("Connection failed", `<h1>Connection failed</h1><p>${String(error)}</p>`));
    return;
  }
  if (!code || !realmId) {
    clearStateCookie(res);
    res.status(400).send(htmlPage("Missing parameters", "<h1>Missing code or realmId from QuickBooks.</h1>"));
    return;
  }

  // CSRF check: the state Intuit hands back must match the one connect.ts
  // put in an HttpOnly cookie right before redirecting there. A mismatch (or
  // a missing cookie, e.g. this callback URL was opened directly) means this
  // request didn't originate from a connect flow we started ourselves.
  const expectedState = req.cookies?.qbo_oauth_state;
  clearStateCookie(res);
  if (!expectedState || expectedState !== state) {
    console.error("QBO callback state mismatch", { expectedState, receivedState: state });
    res
      .status(400)
      .send(
        htmlPage(
          "Connection failed",
          "<h1>Connection failed</h1><p>Could not verify this request came from a connection you started. Please try connecting again.</p>",
        ),
      );
    return;
  }

  const tokenRes = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: intuitBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: QBO_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    const tid = tokenRes.headers.get("intuit_tid");
    console.error("QBO token exchange failed", { intuit_tid: tid, body: text });
    res
      .status(502)
      .send(
        htmlPage(
          "Token exchange failed",
          `<h1>Token exchange failed</h1>${tid ? `<p>Reference: ${tid}</p>` : ""}<pre>${text}</pre>`,
        ),
      );
    return;
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const supabase = supabaseAdmin();
  const { error: dbError } = await supabase.from("qbo_connections").upsert(
    {
      realm_id: String(realmId),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "realm_id" },
  );

  if (dbError) {
    console.error("QBO connection storage failed", dbError);
    res.status(500).send(htmlPage("Storage failed", `<h1>Could not store connection</h1><pre>${dbError.message}</pre>`));
    return;
  }

  res
    .status(200)
    .send(
      htmlPage(
        "Connected to QuickBooks",
        `<h1>Connected to QuickBooks</h1><p>Company ${String(realmId)} is now linked. You can close this window.</p>`,
      ),
    );
}
