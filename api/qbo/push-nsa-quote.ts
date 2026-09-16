import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/qbo.js";
import { createEstimate, createInvoice, type QboLine } from "../_lib/qboApi.js";

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
    const isInvoice = quote.status === "invoiced";
    const customerId = quote.qbo_customer_id ?? undefined;
    const result = isInvoice
      ? await createInvoice({ customerName: quote.client_name, customerId, lines })
      : await createEstimate({ customerName: quote.client_name, customerId, lines });

    // QBO assigns its own DocNumber under the company's real numbering
    // (respecting whatever custom format is configured there) — that's the
    // number that actually exists in her books, so it replaces whatever
    // placeholder was on the row (or nothing, for docs created straight from
    // a job sheet, which never had a typed number to begin with).
    const updateFields = isInvoice
      ? { nsa_invoice_number: result.docNumber, quote_number: result.docNumber, qbo_invoice_id: result.id }
      : { quote_number: result.docNumber, qbo_estimate_id: result.id };

    const { error: updateError } = await supabase.from("nsa_quotes").update(updateFields).eq("id", quoteId);
    if (updateError) {
      // The push to QBO already succeeded — a failure here just means our
      // own record doesn't show the real number yet, not that anything is
      // wrong in QuickBooks. Log it, but still report success to the caller.
      console.error("push-nsa-quote: created in QBO but failed to save the reference back", updateError);
    }

    res.status(200).json({ success: true, qboId: result.id, qboDocNumber: result.docNumber });
  } catch (err) {
    console.error("push-nsa-quote failed", { quoteId, err });
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
