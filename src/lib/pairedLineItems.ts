import type { LineItem, LineItemInput } from "../types";

// UI-only concept — mirrors the real spreadsheet's per-row layout (client
// price and supplier cost side by side on one line, e.g. "Lanyard" priced to
// the client and costed from a supplier on the same row). Never persisted as
// its own shape: job_sheets still stores client_lines/expense_lines exactly
// as before, so the database schema, fee-cascade math, and the whole QBD
// sync pipeline stay untouched.
export interface PairedRow {
  id: string;
  description: string;
  clientQty: number;
  clientUnitCost: number;
  vendorName: string;
  supplierQty: number;
  supplierUnitCost: number;
}

export function emptyPairedRow(): PairedRow {
  return {
    id: crypto.randomUUID(),
    description: "",
    clientQty: 1,
    clientUnitCost: 0,
    vendorName: "",
    supplierQty: 1,
    supplierUnitCost: 0,
  };
}

// Splits combined UI rows back into the two independent arrays the database
// actually stores. A row only produces a client_lines entry if it has a
// client qty/price set, and only produces an expense_lines entry if it has a
// supplier qty/cost set — matching the real spreadsheet, where not every
// expense is billed to the client (e.g. bulk printing folded into markup on
// other items) and not every client line has a tracked cost.
export function pairedRowsToLines(rows: PairedRow[]): {
  clientLines: LineItemInput[];
  expenseLines: LineItemInput[];
} {
  const clientLines: LineItemInput[] = [];
  const expenseLines: LineItemInput[] = [];
  for (const row of rows) {
    const hasClient = row.clientQty > 0 || row.clientUnitCost > 0;
    const hasSupplier = row.supplierQty > 0 || row.supplierUnitCost > 0;
    if (hasClient) {
      clientLines.push({
        id: row.id,
        description: row.description,
        qty: row.clientQty,
        unitCost: row.clientUnitCost,
      });
    }
    if (hasSupplier) {
      expenseLines.push({
        id: row.id,
        description: row.description,
        qty: row.supplierQty,
        unitCost: row.supplierUnitCost,
        vendorName: row.vendorName || undefined,
      });
    }
  }
  return { clientLines, expenseLines };
}

// Reconstructs combined rows from the two stored arrays for editing —
// matches by id (rows created via this UI share one id across both sides),
// falling back to a client-only or supplier-only row for anything that
// doesn't match (e.g. a job sheet converted from an NSA Quote, which only
// ever has client lines with no matching expense id yet).
export function linesToPairedRows(clientLines: LineItem[], expenseLines: LineItem[]): PairedRow[] {
  const rows = new Map<string, PairedRow>();

  for (const c of clientLines) {
    rows.set(c.id, {
      id: c.id,
      description: c.description,
      clientQty: c.qty,
      clientUnitCost: c.unitCost,
      vendorName: "",
      supplierQty: 0,
      supplierUnitCost: 0,
    });
  }

  for (const e of expenseLines) {
    const existing = rows.get(e.id);
    if (existing) {
      existing.vendorName = e.vendorName ?? "";
      existing.supplierQty = e.qty;
      existing.supplierUnitCost = e.unitCost;
    } else {
      rows.set(e.id, {
        id: e.id,
        description: e.description,
        clientQty: 0,
        clientUnitCost: 0,
        vendorName: e.vendorName ?? "",
        supplierQty: e.qty,
        supplierUnitCost: e.unitCost,
      });
    }
  }

  const result = [...rows.values()];
  return result.length > 0 ? result : [emptyPairedRow()];
}
