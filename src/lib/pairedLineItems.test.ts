import { describe, expect, it } from "vitest";
import { linesToPairedRows, pairedRowsToLines, type PairedRow } from "./pairedLineItems";
import type { LineItem } from "../types";

function row(overrides: Partial<PairedRow> = {}): PairedRow {
  return {
    id: "r1",
    description: "Lanyard",
    clientQty: 1000,
    clientUnitCost: 30.74,
    vendorName: "",
    supplierQty: 1000,
    supplierUnitCost: 9.49,
    ...overrides,
  };
}

describe("pairedRowsToLines", () => {
  it("splits a fully paired row into matching client and expense lines with the same id", () => {
    const { clientLines, expenseLines } = pairedRowsToLines([
      row({ vendorName: "Promo Supplies CC" }),
    ]);
    expect(clientLines).toEqual([
      { id: "r1", description: "Lanyard", qty: 1000, unitCost: 30.74 },
    ]);
    expect(expenseLines).toEqual([
      { id: "r1", description: "Lanyard", qty: 1000, unitCost: 9.49, vendorName: "Promo Supplies CC" },
    ]);
  });

  it("omits the expense line for a client-only row (pure margin, no tracked cost)", () => {
    const { clientLines, expenseLines } = pairedRowsToLines([
      row({ supplierQty: 0, supplierUnitCost: 0 }),
    ]);
    expect(clientLines).toHaveLength(1);
    expect(expenseLines).toHaveLength(0);
  });

  it("omits the client line for a supplier-only row (cost folded into markup elsewhere, e.g. bulk printing)", () => {
    const { clientLines, expenseLines } = pairedRowsToLines([
      row({ description: "Printing", clientQty: 0, clientUnitCost: 0, vendorName: "PrintCo" }),
    ]);
    expect(clientLines).toHaveLength(0);
    expect(expenseLines).toEqual([
      { id: "r1", description: "Printing", qty: 1000, unitCost: 9.49, vendorName: "PrintCo" },
    ]);
  });

  it("drops a row with nothing set on either side", () => {
    const { clientLines, expenseLines } = pairedRowsToLines([
      row({ clientQty: 0, clientUnitCost: 0, supplierQty: 0, supplierUnitCost: 0 }),
    ]);
    expect(clientLines).toHaveLength(0);
    expect(expenseLines).toHaveLength(0);
  });
});

describe("linesToPairedRows", () => {
  it("recombines matching client/expense lines (same id) into one paired row", () => {
    const clientLines: LineItem[] = [
      { id: "r1", description: "Lanyard", qty: 1000, unitCost: 30.74, lineTotal: 30740 },
    ];
    const expenseLines: LineItem[] = [
      { id: "r1", description: "Lanyard", qty: 1000, unitCost: 9.49, lineTotal: 9490, vendorName: "Promo Supplies CC" },
    ];
    const rows = linesToPairedRows(clientLines, expenseLines);
    expect(rows).toEqual([
      {
        id: "r1",
        description: "Lanyard",
        clientQty: 1000,
        clientUnitCost: 30.74,
        vendorName: "Promo Supplies CC",
        supplierQty: 1000,
        supplierUnitCost: 9.49,
      },
    ]);
  });

  it("keeps an unmatched client line as a client-only row (e.g. an NSA-converted job sheet with no expenses yet)", () => {
    const clientLines: LineItem[] = [
      { id: "c1", description: "Powerbanks", qty: 500, unitCost: 250, lineTotal: 125000 },
    ];
    const rows = linesToPairedRows(clientLines, []);
    expect(rows).toEqual([
      {
        id: "c1",
        description: "Powerbanks",
        clientQty: 500,
        clientUnitCost: 250,
        vendorName: "",
        supplierQty: 0,
        supplierUnitCost: 0,
      },
    ]);
  });

  it("keeps an unmatched expense line as a supplier-only row", () => {
    const expenseLines: LineItem[] = [
      { id: "e1", description: "Printing", qty: 1000, unitCost: 13, lineTotal: 13000, vendorName: "PrintCo" },
    ];
    const rows = linesToPairedRows([], expenseLines);
    expect(rows).toEqual([
      {
        id: "e1",
        description: "Printing",
        clientQty: 0,
        clientUnitCost: 0,
        vendorName: "PrintCo",
        supplierQty: 1000,
        supplierUnitCost: 13,
      },
    ]);
  });

  it("falls back to one empty row when both arrays are empty (new job sheet)", () => {
    const rows = linesToPairedRows([], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("");
  });

  it("round-trips through pairedRowsToLines and back without losing data", () => {
    const original = [
      row({ id: "a", description: "Lanyard", vendorName: "Promo Supplies CC" }),
      row({ id: "b", description: "Printing", clientQty: 0, clientUnitCost: 0, vendorName: "PrintCo" }),
      row({ id: "c", description: "Consulting", supplierQty: 0, supplierUnitCost: 0 }),
    ];
    const { clientLines, expenseLines } = pairedRowsToLines(original);
    const withTotals = {
      clientLines: clientLines.map((l) => ({ ...l, lineTotal: l.qty * l.unitCost })),
      expenseLines: expenseLines.map((l) => ({ ...l, lineTotal: l.qty * l.unitCost })),
    };
    const roundTripped = linesToPairedRows(withTotals.clientLines, withTotals.expenseLines);
    expect(roundTripped.sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      original.sort((x, y) => x.id.localeCompare(y.id)),
    );
  });
});
