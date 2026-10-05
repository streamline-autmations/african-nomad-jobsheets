/**
 * Picks the QBO TaxCode that actually charges South Africa's 15% VAT today.
 *
 * Companies outside the US (this one is South African) don't use QBO's
 * "Automated Sales Tax" special codes ("TAX"/"NON") — they have their own
 * TaxCode records, and a transaction with Sales Tax enabled on the company
 * will be rejected ("Make sure all your transactions have a sales tax rate
 * before you save") if no line carries one. There's no field marking "the"
 * default taxable code, and matching by name is unreliable — this company's
 * "Standard Rate" code charges South Africa's pre-2018 14% — so the code is
 * chosen by the percentage its sales rates really charge.
 *
 * Two things an earlier version got wrong, both of which kept documents going
 * out at 14%:
 * - It read only TaxRate.RateValue. A rate that's been edited keeps its
 *   history in EffectiveTaxRate ("used to know which taxrate is applicable on
 *   any date"), and the top-level RateValue isn't guaranteed to be the one in
 *   force today — so the rate is now read from the entry covering today.
 * - When nothing matched 15% it silently fell back to the code named
 *   "Standard Rate", i.e. the 14% one. Now it throws instead, so a push fails
 *   loudly (the record survives and staff can retry) rather than writing the
 *   wrong VAT into NSA's live books.
 */
export const SA_VAT_RATE = 15;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw QBO TaxCode/TaxRate payloads
type QboRecord = any;

/** The percentage a TaxRate charges on `today` (YYYY-MM-DD). */
export function rateInForce(rate: QboRecord, today: string): number {
  const history = (rate.EffectiveTaxRate ?? []) as QboRecord[];
  const current = history.find(
    (h) =>
      String(h.EffectiveDate ?? "").slice(0, 10) <= today &&
      (!h.EndDate || String(h.EndDate).slice(0, 10) >= today),
  );
  return Number(current?.RateValue ?? rate.RateValue);
}

/** Total sales percentage a TaxCode charges, or undefined if any of its rates is unknown. */
function salesPercent(code: QboRecord, rateById: Map<string, number>): number | undefined {
  const details = (code.SalesTaxRateList?.TaxRateDetail ?? []) as QboRecord[];
  if (details.length === 0) return undefined;
  let total = 0;
  for (const detail of details) {
    const pct = rateById.get(String(detail.TaxRateRef?.value));
    if (pct === undefined || Number.isNaN(pct)) return undefined;
    total += pct;
  }
  return total;
}

export function pickVatTaxCodeId(codes: QboRecord[], rates: QboRecord[], today: string): string {
  const rateById = new Map(rates.map((r) => [String(r.Id), rateInForce(r, today)]));
  const vatCodes = codes.filter((c) => salesPercent(c, rateById) === SA_VAT_RATE);

  // SA companies can have more than one 15% code — "Standard Rate (Capital
  // Goods)" reports on a different VAT201 line — so prefer the plain one.
  const name = (c: QboRecord) => String(c.Name ?? "");
  const chosen =
    vatCodes.find((c) => /standard/i.test(name(c)) && !/capital/i.test(name(c))) ??
    vatCodes.find((c) => /standard/i.test(name(c))) ??
    vatCodes[0];
  if (chosen) return String(chosen.Id);

  const found = codes
    .map((c) => ({ name: name(c), pct: salesPercent(c, rateById) }))
    .filter((c) => c.pct !== undefined)
    .map((c) => `${c.name} (${c.pct}%)`)
    .join(", ");
  throw new Error(
    `QuickBooks has no active tax code charging ${SA_VAT_RATE}% VAT, so nothing was created. ` +
      `Sales tax codes found: ${found || "none"}. Set the VAT rate to ${SA_VAT_RATE}% in QuickBooks (Taxes), then push again.`,
  );
}
