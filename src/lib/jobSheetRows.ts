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
  id: string;
  clientDescription: string;
  clientQty: number;
  clientUnitCost: number;
  supplierDescription: string;
  supplierQty: number;
  supplierUnitCost: number;
  vendorName: string;
}

export function emptySheetRow(): SheetRow {
  return {
    id: crypto.randomUUID(),
    clientDescription: "",
    clientQty: 1,
    clientUnitCost: 0,
    supplierDescription: "",
    supplierQty: 1,
    supplierUnitCost: 0,
    vendorName: "",
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
    if (rowHasClient(row)) {
      clientLines.push({
        id: row.id,
        description: row.clientDescription,
        qty: row.clientQty,
        unitCost: row.clientUnitCost,
        row: index,
      });
    }
    if (rowHasSupplier(row)) {
      expenseLines.push({
        // Distinct from the client line's id: the two sides are separate
        // lines that merely share a row, and an expense line has its own
        // identity in the QBD Bill queue.
        id: `${row.id}-s`,
        description: row.supplierDescription,
        qty: row.supplierQty,
        unitCost: row.supplierUnitCost,
        vendorName: row.vendorName || undefined,
        row: index,
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
  const hasRowNumbers =
    clientLines.some((l) => typeof l.row === "number") ||
    expenseLines.some((l) => typeof l.row === "number");

  const rows: SheetRow[] = [];

  function rowAt(index: number): SheetRow {
    while (rows.length <= index) rows.push(emptySheetRow());
    return rows[index];
  }

  function putClient(index: number, line: LineItem) {
    const row = rowAt(index);
    row.clientDescription = line.description;
    row.clientQty = line.qty;
    row.clientUnitCost = line.unitCost;
  }

  function putSupplier(index: number, line: LineItem) {
    const row = rowAt(index);
    row.supplierDescription = line.description;
    row.supplierQty = line.qty;
    row.supplierUnitCost = line.unitCost;
    row.vendorName = line.vendorName ?? "";
  }

  if (hasRowNumbers) {
    // Row numbers are compacted rather than trusted as absolute positions, so
    // a sheet saved with gaps (or with a stale row number) can't open with a
    // screenful of blank rows in the middle of it.
    const used = [
      ...clientLines.map((l) => l.row),
      ...expenseLines.map((l) => l.row),
    ].filter((r): r is number => typeof r === "number");
    const ordered = [...new Set(used)].sort((a, b) => a - b);
    const compacted = new Map(ordered.map((original, i) => [original, i]));
    const fallbackFrom = ordered.length;

    let appended = 0;
    const indexFor = (line: LineItem) =>
      typeof line.row === "number"
        ? (compacted.get(line.row) as number)
        : fallbackFrom + appended++;

    for (const line of clientLines) putClient(indexFor(line), line);
    for (const line of expenseLines) putSupplier(indexFor(line), line);
  } else {
    // Legacy: the two sides were fused into one row sharing a single id.
    const rowOfId = new Map<string, number>();
    clientLines.forEach((line, i) => {
      rowOfId.set(line.id, i);
      putClient(i, line);
    });
    for (const line of expenseLines) {
      const existing = rowOfId.get(line.id);
      putSupplier(existing ?? rows.length, line);
    }
  }

  while (rows.length < MIN_ROWS) rows.push(emptySheetRow());
  return rows;
}

/** Whether a row is completely untouched on both sides. */
export function rowIsBlank(row: SheetRow): boolean {
  return !rowHasClient(row) && !rowHasSupplier(row);
}

export interface SupplierCostGrouping {
  /** Total supplier cost attributed to each client row; 0 for other rows. */
  costs: number[];
  /** For each row, the client row its cost counts towards, or -1 for none. */
  ownerOf: number[];
}

/**
 * Which supplier rows each client row is costed against.
 *
 * A client row owns the supplier row on its own line plus every supplier row
 * beneath it until the next client row — which is how the real sheets read: a
 * "Black Puffer Jacket" client line sits above the jacket, its branding and
 * its delivery on the supplier side, and its mark-up is measured against all
 * three. The Excel does this with a hardcoded `=(E17-(P17+P18))/E17`, which
 * only ever reaches one row down and silently under-reports a line backed by
 * three costs. This reaches as far as the grouping actually goes.
 *
 * A completely blank row ends the group. That matters: the Cup-a-Soup sheet
 * finishes with an issuing system, a casual and accommodation — real costs on
 * the job that belong to no client line at all. Without a terminator they all
 * pile onto whichever client line happened to come last, which reported that
 * line at -2420% margin. A blank row is how you separate things in a
 * spreadsheet, so it is how you separate them here.
 *
 * Costs owned by nobody still count in full towards the sheet's expense total
 * — they are simply not attributable to one line's mark-up.
 */
export function supplierCostByClientRow(rows: SheetRow[]): SupplierCostGrouping {
  const costs = new Array<number>(rows.length).fill(0);
  const ownerOf = new Array<number>(rows.length).fill(-1);
  let owner = -1;

  rows.forEach((row, index) => {
    if (rowIsBlank(row)) {
      owner = -1;
      return;
    }
    if (rowHasClient(row)) owner = index;
    if (owner >= 0 && rowHasSupplier(row)) {
      ownerOf[index] = owner;
      // round2 per line then again on the sum — the same order
      // calculateLinesSubtotal uses, so a row's mark-up is measured against
      // exactly the number the sheet's expense total counts.
      costs[owner] = round2(costs[owner] + round2(row.supplierQty * row.supplierUnitCost));
    }
  });

  return { costs, ownerOf };
}
