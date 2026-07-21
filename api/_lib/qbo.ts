import { createClient } from "@supabase/supabase-js";

export const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID ?? "";
export const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET ?? "";
export const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI ?? "";
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";

export const INTUIT_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const INTUIT_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export function intuitBasicAuthHeader(): string {
  return `Basic ${Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString("base64")}`;
}

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, serviceRoleKey);
}

export function htmlPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${title}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
text-align:center;padding:4rem 1.5rem;color:#1a1a1a;background:#fff;}
@media (prefers-color-scheme:dark){body{background:#111;color:#e8e8e8;}}
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}
