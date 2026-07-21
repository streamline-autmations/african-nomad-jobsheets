import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/qbo";
import { createEstimate, createInvoice, type QboLine } from "../_lib/qboApi";

interface NsaQuoteLine {
  description: string;
  qty: number;
  unitCost: number;
}

/**
 * Pushes an NSA quote (or invoice) into the connected QuickBooks Online
 * company as a real Estimate/Invoice. Demo/showcase endpoint — creates the
 * QBO Customer and Item on first use if they don't already exist there.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST with { quoteId }" });
    return;
  }

  const quoteId = (req.body?.quoteId ?? req.query.quoteId) as string | undefined;
  if (!quoteId) {
    res.status(400).json({ error: "quoteId is required" });
    return;
  }

  const supabase = supabaseAdmin();
  const { data: quote, error } = await supabase.from("nsa_quotes").select("*").eq("id", quoteId).maybeSingle();

  if (error || !quote) {
    res.status(404).json({ error: "Quote not found" });
    return;
  }

  const lines: QboLine[] = ((quote.lines as NsaQuoteLine[]) ?? []).map((line) => ({
    description: line.description,
    qty: line.qty,
    unitPrice: line.unitCost,
  }));

  if (lines.length === 0) {
    res.status(400).json({ error: "This quote has no line items to push." });
    return;
  }

  try {
    const result =
      quote.status === "invoiced"
        ? await createInvoice({ customerName: quote.client_name, lines })
        : await createEstimate({ customerName: quote.client_name, lines });

    res.status(200).json({ success: true, qboId: result.id, qboDocNumber: result.docNumber });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
