/** Escape a value for safe inclusion in XML element content or attributes. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Strip control characters QBD rejects and collapse whitespace runs. */
function cleanText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * QuickBooks Desktop list names (Customer Name, Item Name, Vendor Name, …)
 * are hard-capped at 41 characters and must not contain colons (colon is
 * QBD's parent:child list separator). Every place that writes OR references
 * a name must go through this same function, otherwise a CustomerAdd and the
 * later CustomerRef would disagree about long names.
 */
export function qbdName(value: string): string {
  return cleanText(value).replace(/:/g, "-").slice(0, 41).trim();
}

/** Transaction line descriptions / memos: QBD caps Desc at 4095 chars. */
export function qbdDesc(value: string): string {
  return cleanText(value).slice(0, 4095);
}

/** Money as QBD expects it: plain decimal, two places, no thousands separators. */
export function qbdAmount(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

/** Quantities: up to 5 decimal places, trailing zeros trimmed. */
export function qbdQuantity(value: number): string {
  return String(Number(value.toFixed(5)));
}
