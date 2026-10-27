import { describe, expect, it } from "vitest";
import {
  emptySheetRow,
  linesToSheetRows,
  sheetRowsToLines,
  supplierCostByClientRow,
  type SheetRow,
} from "./jobSheetRows";
import { withLineTotal } from "./feeCalculations";
import type { LineItem } from "../types";

function sheetRow(overrides: Partial<SheetRow> = {}): SheetRow {
  return { ...emptySheetRow(), ...overrides };
}

function client(description: string, qty: number, unitCost: number): Partial<SheetRow> {
  return { clientDescription: description, clientQty: qty, clientUnitCost: unitCost };
}

function supplier(description: string, qty: number, unitCost: number): Partial<SheetRow> {
  return { supplierDescription: description, supplierQty: qty, supplierUnitCost: unitCost };
}

function storedLine(
  id: string,
  description: string,
  qty: number,
  unitCost: number,
  extra: Partial<LineItem> = {},
): LineItem {
  return withLineTotal({ id, description, qty, unitCost, ...extra });
}

describe("sheetRowsToLines", () => {
  it("splits the two sides into the two arrays the database stores", () => {
    const { clientLines, expenseLines } = sheetRowsToLines([
      sheetRow({ ...client("Beanies", 16, 70), ...supplier("Beanies", 16, 40) }),
    ]);

    expect(clientLines).toHaveLength(1);
    expect(expenseLines).toHaveLength(1);
    expect(clientLines[0]).toMatchObject({ description: "Beanies", qty: 16, unitCost: 70, row: 0 });
    expect(expenseLines[0]).toMatchObject({ description: "Beanies", qty: 16, unitCost: 40, row: 0 });
  });

  it("keeps the two sides' descriptions independent", () => {
    // The Excel has DESCRIPTION and SUPPLIER ITEMS as separate columns; the
    // old fused model forced one shared description across both.
    const { clientLines, expenseLines } = sheetRowsToLines([
      sheetRow({
        ...client("Kooshty Neo Refreshment Kit", 800, 335),
        ...supplier("Kooshty Neo (bulk, 20-pack)", 40, 5000),
      }),
    ]);

    expect(clientLines[0].description).toBe("Kooshty Neo Refreshment Kit");
    expect(expenseLines[0].description).toBe("Kooshty Neo (bulk, 20-pack)");
  });

  it("emits a supplier-only row with no client line", () => {
    const { clientLines, expenseLines } = sheetRowsToLines([
      sheetRow({ ...client("Jacket", 35, 475), ...supplier("Jacket", 35, 289) }),
      sheetRow({ ...supplier("Branding", 35, 15) }),
    ]);

    expect(clientLines).toHaveLength(1);
    expect(expenseLines).toHaveLength(2);
    expect(expenseLines[1]).toMatchObject({ description: "Branding", row: 1 });
  });

  it("emits a client-only row with no supplier line", () => {
    const { clientLines, expenseLines } = sheetRowsToLines([
      sheetRow({ ...client("Management time", 1, 5000) }),
    ]);

    expect(clientLines).toHaveLength(1);
    expect(expenseLines).toHaveLength(0);
  });

  it("keeps a real zero-cost line that has a description", () => {
    // "Backpack", 1230 units at R0.00 — priced into the bag line beside it in
    // the travel-bag sheet. Dropping it would lose a real line of the job.
    const { expenseLines } = sheetRowsToLines([sheetRow({ ...supplier("Backpack", 1230, 0) })]);
    expect(expenseLines).toHaveLength(1);
    expect(expenseLines[0].description).toBe("Backpack");
  });

  it("drops blank rows entirely", () => {
    const { clientLines, expenseLines } = sheetRowsToLines([
      emptySheetRow(),
      emptySheetRow(),
      sheetRow({ ...client("Real line", 1, 100) }),
    ]);

    expect(clientLines).toHaveLength(1);
    expect(expenseLines).toHaveLength(0);
    // ...and the surviving line remembers which row it was actually on.
    expect(clientLines[0].row).toBe(2);
  });

  it("gives the two sides of a row different ids", () => {
    const { clientLines, expenseLines } = sheetRowsToLines([
      sheetRow({ ...client("Boots", 1, 100), ...supplier("Boots", 1, 60) }),
    ]);
    expect(clientLines[0].id).not.toBe(expenseLines[0].id);
  });

  it("carries the vendor name onto the expense line only", () => {
    const { clientLines, expenseLines } = sheetRowsToLines([
      sheetRow({
        ...client("Cups", 2400, 3),
        ...supplier("Cups", 2400, 2.07),
        vendorName: "Vaalpac",
      }),
    ]);

    expect(expenseLines[0].vendorName).toBe("Vaalpac");
    expect(clientLines[0].vendorName).toBeUndefined();
  });
});

describe("linesToSheetRows", () => {
  it("round-trips a sheet through save and reload with rows intact", () => {
    const original = [
      sheetRow({ ...client("Jacket", 35, 475), ...supplier("Jacket", 35, 289) }),
      sheetRow({ ...supplier("Branding", 35, 15), vendorName: "Pantone" }),
      sheetRow({ ...client("Delivery", 1, 500), ...supplier("Delivery", 1, 500) }),
    ];

    const { clientLines, expenseLines } = sheetRowsToLines(original);
    const reloaded = linesToSheetRows(
      clientLines.map((l) => withLineTotal(l)),
      expenseLines.map((l) => withLineTotal(l)),
    );

    expect(reloaded[0]).toMatchObject(client("Jacket", 35, 475));
    expect(reloaded[0]).toMatchObject(supplier("Jacket", 35, 289));
    expect(reloaded[1].clientDescription).toBe("");
    expect(reloaded[1]).toMatchObject(supplier("Branding", 35, 15));
    expect(reloaded[1].vendorName).toBe("Pantone");
    expect(reloaded[2]).toMatchObject(client("Delivery", 1, 500));
  });

  it("closes gaps left by blank rows instead of reopening them", () => {
    const { clientLines, expenseLines } = sheetRowsToLines([
      emptySheetRow(),
      emptySheetRow(),
      sheetRow({ ...client("Real line", 1, 100) }),
    ]);
    const reloaded = linesToSheetRows(
      clientLines.map((l) => withLineTotal(l)),
      expenseLines.map((l) => withLineTotal(l)),
    );

    expect(reloaded[0].clientDescription).toBe("Real line");
  });

  it("falls back to the old shared-id pairing for legacy lines with no row number", () => {
    const reloaded = linesToSheetRows(
      [storedLine("shared-1", "Boots", 500, 450), storedLine("shared-2", "Hats", 500, 180)],
      [
        storedLine("shared-1", "Boots cost", 500, 300, { vendorName: "Vicbay" }),
        storedLine("shared-2", "Hats cost", 500, 100),
      ],
    );

    expect(reloaded[0]).toMatchObject(client("Boots", 500, 450));
    expect(reloaded[0]).toMatchObject(supplier("Boots cost", 500, 300));
    expect(reloaded[0].vendorName).toBe("Vicbay");
    expect(reloaded[1]).toMatchObject(client("Hats", 500, 180));
    expect(reloaded[1]).toMatchObject(supplier("Hats cost", 500, 100));
  });

  it("appends a legacy expense line whose id matches no client line", () => {
    const reloaded = linesToSheetRows(
      [storedLine("c1", "Boots", 1, 450)],
      [storedLine("orphan", "Bulk printing", 1, 900)],
    );

    expect(reloaded[0]).toMatchObject(client("Boots", 1, 450));
    expect(reloaded[0].supplierDescription).toBe("");
    expect(reloaded[1]).toMatchObject(supplier("Bulk printing", 1, 900));
  });

  it("handles a job sheet converted from an NSA quote — client lines only", () => {
    const reloaded = linesToSheetRows([storedLine("q1", "Kooshty Neo Kit", 800, 335)], []);
    expect(reloaded[0]).toMatchObject(client("Kooshty Neo Kit", 800, 335));
    expect(reloaded[0].supplierDescription).toBe("");
  });

  it("always returns enough rows to type into", () => {
    expect(linesToSheetRows([], []).length).toBeGreaterThanOrEqual(4);
    expect(linesToSheetRows([], []).every((r) => r.clientDescription === "")).toBe(true);
  });

  it("keeps a blank separator row through a reload", () => {
    const original = [
      sheetRow({ ...client("Delivery", 1, 500), ...supplier("Delivery", 1, 500) }),
      emptySheetRow(),
      sheetRow({ ...supplier("Accommodation", 1, 7100) }),
    ];
    const { clientLines, expenseLines } = sheetRowsToLines(original);
    const reloaded = linesToSheetRows(
      clientLines.map((l) => withLineTotal(l)),
      expenseLines.map((l) => withLineTotal(l)),
    );

    expect(reloaded[1].supplierDescription).toBe("");
    expect(reloaded[2].supplierDescription).toBe("Accommodation");
    expect(supplierCostByClientRow(reloaded).slice(0, 3)).toEqual([500, 0, 0]);
  });

  it("collapses a wide gap to a single blank row rather than a screenful", () => {
    const reloaded = linesToSheetRows(
      [storedLine("c1", "First", 1, 100, { row: 0 }), storedLine("c2", "Later", 1, 200, { row: 40 })],
      [],
    );
    expect(reloaded[0].clientDescription).toBe("First");
    expect(reloaded[1].clientDescription).toBe("");
    expect(reloaded[2].clientDescription).toBe("Later");
  });

  it("round-trips line ids instead of minting new ones on every save", () => {
    const first = linesToSheetRows(
      [storedLine("client-1", "Boots", 1, 450, { row: 0 })],
      [storedLine("supplier-1", "Boots cost", 1, 300, { row: 0 })],
    );
    const { clientLines, expenseLines } = sheetRowsToLines(first);

    expect(clientLines[0].id).toBe("client-1");
    expect(expenseLines[0].id).toBe("supplier-1");
  });

  it("pairs legacy lines by shared id even when other lines already carry a row", () => {
    // A document can hold both eras at once; one migrated line must not strand
    // every un-migrated one on a row of its own.
    const reloaded = linesToSheetRows(
      [
        storedLine("new-1", "Migrated", 1, 100, { row: 0 }),
        storedLine("shared", "Legacy client", 2, 50),
      ],
      [
        storedLine("new-1-s", "Migrated cost", 1, 60, { row: 0 }),
        storedLine("shared", "Legacy cost", 2, 30),
      ],
    );

    expect(reloaded[0]).toMatchObject(client("Migrated", 1, 100));
    expect(reloaded[0]).toMatchObject(supplier("Migrated cost", 1, 60));
    // The legacy pair stays on one row.
    expect(reloaded[1]).toMatchObject(client("Legacy client", 2, 50));
    expect(reloaded[1]).toMatchObject(supplier("Legacy cost", 2, 30));
    expect(reloaded.filter((r) => r.clientDescription === "Legacy client")).toHaveLength(1);
  });

  it("gives every row a distinct id", () => {
    const rows = linesToSheetRows([storedLine("c1", "A", 1, 1)], [storedLine("e1", "B", 1, 1)]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
});

describe("supplierCostByClientRow", () => {
  it("gives a client row the cost of the supplier row beside it", () => {
    const costs = supplierCostByClientRow([
      sheetRow({ ...client("Boots", 10, 100), ...supplier("Boots", 10, 60) }),
    ]);
    expect(costs[0]).toBe(600);
  });

  it("does not fold the cost-only rows beneath a client row into it", () => {
    // Jacket + branding + delivery: the jacket line is measured against the
    // jacket cell across from it (35 x 289), not the 525 and 500 below it.
    const costs = supplierCostByClientRow([
      sheetRow({
        ...client("Black Puffer Jacket + 2 position embroidery", 35, 475),
        ...supplier("Black Puffer Jacket + 2 position embroidery", 35, 289),
      }),
      sheetRow({ ...supplier("Branding", 35, 15) }),
      sheetRow({ ...supplier("Delivery", 1, 500) }),
    ]);

    expect(costs).toEqual([10115, 0, 0]);
  });

  it("gives two lines for the same product the same cost whatever sits beneath them", () => {
    // Same product, same cost, on two lines — one with a cost-only row under
    // it, one without. Both must read the same, or "Price every line at"
    // prices the same product two ways.
    const costs = supplierCostByClientRow([
      sheetRow({ ...client("Beanies", 10, 70), ...supplier("Beanies", 10, 50) }),
      sheetRow({ ...supplier("Branding", 10, 15) }),
      sheetRow({ ...client("Beanies", 10, 70), ...supplier("Beanies", 10, 50) }),
    ]);

    expect(costs[0]).toBe(500);
    expect(costs[2]).toBe(500);
  });

  it("is zero for a cost-only row, wherever it sits", () => {
    const costs = supplierCostByClientRow([
      sheetRow({ ...supplier("Deposit", 1, 1000) }),
      sheetRow({ ...client("Job", 1, 5000), ...supplier("Job cost", 1, 3000) }),
      emptySheetRow(),
      sheetRow({ ...supplier("Accommodation", 1, 7100) }),
    ]);

    expect(costs).toEqual([0, 3000, 0, 0]);
  });

  it("is zero for a client-only row", () => {
    const costs = supplierCostByClientRow([sheetRow({ ...client("Management time", 1, 5000) })]);
    expect(costs).toEqual([0]);
  });

  it("returns zeroes for an empty sheet without throwing", () => {
    expect(supplierCostByClientRow([])).toEqual([]);
    expect(supplierCostByClientRow([emptySheetRow()])).toEqual([0]);
  });
});
