import { round2 } from "./feeCalculations";
import type { LineItem, LineItemInput } from "../types";

// ---------------------------------------------------------------------------
// The sheet, as a list of rows.
//
// The real Excel job sheet is two independent lists sitting side by side: a
// CLIENT block (what the mine is charged) and a COMPANY EXPENSES / SUPPLIER
// ITEMS block (what it costs us). They share row numbers but not content —
// row 18 can be a supplier "Branding" line with nothing on the client side,
// and row 26 can be a cost with no client line at all.
//
// A SheetRow is one of those shared row numbers. Either side may be blank.
// This is *not* a fused line: the two sides carry their own descriptions and
// their own quantities, exactly as the spreadsheet does.
//
// Never persisted as its own shape — job_sheets still stores client_lines and
// expense_lines as two separate jsonb arrays, which is what this model is
// already shaped like. Each line carries its row number so the two columns
// line up again on reload.
// ---------------------------------------------------------------------------
export interface SheetRow {
  /** Identity of the row itself — React keys and nothing else. */
  id: string;
  /** Ids of the stored lines this row came from, so a save round-trips the
   * identity it was loaded with instead of minting a new one every time. */
  clientLineId?: string;
  supplierLineId?: string;
  clientDescription: string;
  clientQty: number;
  clientUnitCost: number;
  supplierDescription: string;
  supplierQty: number;
  supplierUnitCost: number;
  vendorName: string;
  /** Storage paths of photos attached to this row — see LineItemInput.photoPaths. */
  photoPaths: string[];
}

export function emptySheetRow(): SheetRow {
  return {
    id: crypto.randomUUID(),
    clientLineId: undefined,
    supplierLineId: undefined,
    clientDescription: "",
    clientQty: 1,
    clientUnitCost: 0,
    supplierDescription: "",
    supplierQty: 1,
    supplierUnitCost: 0,
    vendorName: "",
    photoPaths: [],
  };
}

/**
 * Whether a side of a row has actually been filled in.
 *
 * A description alone counts, because a real zero-cost line exists: the
 * travel-bag sheet has "Backpack", 1230 units, at R0.00 — priced into the
 * bag line next to it. Requiring a non-zero cost would silently drop it.
 * Quantity alone does not count, because every blank row starts at qty 1.
 */
function sideIsFilled(description: string, unitCost: number): boolean {
  return description.trim() !== "" || unitCost > 0;
}

export function rowHasClient(row: SheetRow): boolean {
  return sideIsFilled(row.clientDescription, row.clientUnitCost);
}

export function rowHasSupplier(row: SheetRow): boolean {
  return sideIsFilled(row.supplierDescription, row.supplierUnitCost);
}

/**
 * Splits the sheet back into the two arrays the database stores, tagging each
 * line with the row it sat on.
 */
export function sheetRowsToLines(rows: SheetRow[]): {
  clientLines: LineItemInput[];
  expenseLines: LineItemInput[];
} {
  const clientLines: LineItemInput[] = [];
  const expenseLines: LineItemInput[] = [];

  rows.forEach((row, index) => {
    // A row's photos are attributed to whichever side actually exists —
    // preferring the client line, since that's the item the photo is usually
    // taken to show the mine. A row with both sides filled only carries one
    // set of photos, not a duplicate on each line.
    const photoPaths = row.photoPaths.length > 0 ? row.photoPaths : undefined;
    const hasClient = rowHasClient(row);

    if (hasClient) {
      clientLines.push({
        id: row.clientLineId ?? `${row.id}-c`,
        description: row.clientDescription,
        qty: row.clientQty,
        unitCost: row.clientUnitCost,
        row: index,
        photoPaths,
      });
    }
    if (rowHasSupplier(row)) {
      expenseLines.push({
        // Distinct from the client line's id: the two sides are separate
        // lines that merely share a row, and an expense line has its own
        // identity in the QBD Bill queue.
        id: row.supplierLineId ?? `${row.id}-s`,
        description: row.supplierDescription,
        qty: row.supplierQty,
        unitCost: row.supplierUnitCost,
        vendorName: row.vendorName || undefined,
        row: index,
        photoPaths: hasClient ? undefined : photoPaths,
      });
    }
  });

  return { clientLines, expenseLines };
}

/** The minimum number of rows the grid always shows, so a fresh sheet has
 * somewhere to type. */
const MIN_ROWS = 4;

/**
 * Rebuilds the sheet from the two stored arrays for editing.
 *
 * Two eras of data to handle:
 *   - Lines written since 2026-08-19 carry `row`, and go straight back to it.
 *   - Older lines don't. Those fall back to the previous model's convention,
 *     where a client line and its expense line shared one id; anything left
 *     over is appended in order. A job sheet converted from an NSA quote has
 *     client lines only and no ids in common with anything, which the same
 *     fallback handles.
 */
export function linesToSheetRows(clientLines: LineItem[], expenseLines: LineItem[]): SheetRow[] {
  const rows: SheetRow[] = [];

  function rowAt(index: number): SheetRow {
    while (rows.length <= index) rows.push(emptySheetRow());
    return rows[index];
  }

  function putClient(index: number, line: LineItem) {
    const row = rowAt(index);
    row.clientLineId = line.id;
    row.clientDescription = line.description;
    row.clientQty = line.qty;
    row.clientUnitCost = line.unitCost;
    if (line.photoPaths?.length) row.photoPaths = line.photoPaths;
  }

  function putSupplier(index: number, line: LineItem) {
    const row = rowAt(index);
    row.supplierLineId = line.id;
    row.supplierDescription = line.description;
    row.supplierQty = line.qty;
    row.supplierUnitCost = line.unitCost;
    row.vendorName = line.vendorName ?? "";
    if (line.photoPaths?.length) row.photoPaths = line.photoPaths;
  }

  const hasRow = (l: LineItem) => typeof l.row === "number";
  const positioned = [...clientLines, ...expenseLines].filter(hasRow);

  // Gaps are preserved, but collapsed to a single blank row each.
  //
  // Flattening them away would change the layout people built on the sheet;
  // keeping the raw row numbers would reopen a sheet with a screenful of
  // blanks wherever someone had deleted rows. One blank row per gap keeps the
  // separation without the emptiness.
  const ordered = [...new Set(positioned.map((l) => l.row as number))].sort((a, b) => a - b);
  const placed = new Map<number, number>();
  let cursor = 0;
  ordered.forEach((original, i) => {
    if (i > 0 && original > ordered[i - 1] + 1) cursor += 1; // one blank separator
    placed.set(original, cursor);
    cursor += 1;
  });

  for (const line of clientLines) {
    if (hasRow(line)) putClient(placed.get(line.row as number) as number, line);
  }
  for (const line of expenseLines) {
    if (hasRow(line)) putSupplier(placed.get(line.row as number) as number, line);
  }

  // Legacy lines carry no row number. They are paired the old way — a client
  // line and its expense line shared a single id — and appended after anything
  // positioned. Handled per line rather than per document, so one migrated line
  // can't strand every un-migrated one on its own row.
  const legacyClient = clientLines.filter((l) => !hasRow(l));
  const legacyExpense = expenseLines.filter((l) => !hasRow(l));
  const rowOfLegacyId = new Map<string, number>();

  for (const line of legacyClient) {
    const index = rows.length;
    rowOfLegacyId.set(line.id, index);
    putClient(index, line);
  }
  for (const line of legacyExpense) {
    putSupplier(rowOfLegacyId.get(line.id) ?? rows.length, line);
  }

  while (rows.length < MIN_ROWS) rows.push(emptySheetRow());
  return rows;
}

/** Whether a row is completely untouched on both sides. */
export function rowIsBlank(row: SheetRow): boolean {
  return !rowHasClient(row) && !rowHasSupplier(row);
}

/**
 * The supplier cost each client row's mark-up is measured against: the
 * supplier cell directly across from it on the same row, and nothing else.
 * 0 for a row with no client side or no supplier side.
 *
 * A supplier row with no client line opposite it (branding, delivery, a
 * casual) is a plain cost. It counts in full towards the sheet's expense total
 * but is never folded into the mark-up of the client line above it. Rolling
 * those rows up used to make two lines for the same product read different
 * mark-ups — and "Price every line at" price them differently — depending on
 * what happened to sit beneath each one.
 */
export function supplierCostByClientRow(rows: SheetRow[]): number[] {
  // round2 on the line total, the same as calculateLinesSubtotal, so a row's
  // mark-up is measured against exactly the number the expense total counts.
  return rows.map((row) =>
    rowHasClient(row) && rowHasSupplier(row) ? round2(row.supplierQty * row.supplierUnitCost) : 0,
  );
}
