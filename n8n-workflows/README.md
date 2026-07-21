# n8n workflows

Exported workflow definitions for the shared n8n instance at
`https://dockerfile-1n82.onrender.com`. That instance runs automation for
several other clients too — these files are additive; nothing here touches
or replaces any existing workflow there.

## nsa-quote-to-qbo.json

**Live and active** on the instance (workflow id `fN1aJF1BFOPCjzI0`).
Production webhook: `POST https://dockerfile-1n82.onrender.com/webhook/nsa-quote-to-qbo`
with body `{ "quoteId": "<nsa_quotes row id>" }`.

Flow: Webhook → HTTP Request (calls our own `api/qbo/push-nsa-quote` on Vercel,
which creates/updates the Estimate or Invoice in the connected QuickBooks
Online company) → Respond to Webhook (forwards the result, including on
non-2xx, so a failed push is visible to the caller instead of silently
swallowed).

To re-import if ever needed: n8n UI → Workflows → Import from File → this
JSON. To re-sync this file after editing the live workflow in n8n's UI:
`GET /api/v1/workflows/fN1aJF1BFOPCjzI0` and strip the runtime-only fields
(`id`, `active`, `versionId`, `shared`, timestamps, etc.), keeping only
`name`, `nodes`, `connections`, `settings`.
