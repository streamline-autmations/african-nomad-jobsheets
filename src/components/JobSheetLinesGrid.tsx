import { useEffect, useId, useRef, useState } from "react";
import { exclVat, inclVat, round2 } from "../lib/feeCalculations";
import { clientUnitCostForMargin, marginPctFromTotals } from "../lib/markup";
import {
  emptySheetRow,
  rowHasClient,
  rowHasSupplier,
  supplierCostByClientRow,
  type SheetRow,
} from "../lib/jobSheetRows";
import type { JobSheetFinancials } from "../types";

// ---------------------------------------------------------------------------
// The job sheet, as the spreadsheet it has always been.
//
// Two column blocks side by side — CLIENT (what the mine is charged) and
// COMPANY EXPENSES (what it costs us) — sharing row numbers but not content,
// exactly as the team's Excel job sheet is laid out. Cells are contiguous, the
// header sticks, and the keyboard works the way it does in Excel, because the
// people using this have costed every job of their careers in a spreadsheet
// and every affordance that reads as "web form" is one they have to translate.
//
// Nothing on this grid animates. For a spreadsheet, stillness is the point:
// the only thing that moves is the cell cursor, and it moves instantly.
// ---------------------------------------------------------------------------

/** Focusable cells, in the order they appear across a row. */
const COLS = [
  "clientDescription",
  "clientQty",
  "clientExcl",
  "clientIncl",
  "markup",
  "supplierDescription",
  "supplierQty",
  "supplierExcl",
  "supplierIncl",
  "vendorName",
] as const;
type Col = (typeof COLS)[number];

/**
 * Reads a number out of whatever a person actually types or pastes — "R 1,120.00",
 * "1 230", "12.5%" — rather than only what a number input would accept. Paste
 * out of Excel or off an invoice PDF carries all of these.
 */
export function parseNumeric(raw: string): number | null {
  const cleaned = raw.replace(/[R\s,%]/g, "").replace(/[()]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  // "(1,200)" is accounting notation for a negative.
  return /^\(.*\)$/.test(raw.trim()) ? -value : value;
}

/** Splits pasted clipboard text into a grid, the way Excel writes it. */
export function parseClipboardGrid(text: string): string[][] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
}

interface NumberCellProps {
  value: number;
  onCommit: (value: number) => void;
  rowIndex: number;
  col: Col;
  className?: string;
  title?: string;
  ariaLabel: string;
  /** Show nothing rather than the underlying default — a blank row in a
   * spreadsheet is blank, not pre-filled with a quantity of 1. */
  blank?: boolean;
  /** Render a real zero as "0" instead of an empty cell. A line sold at cost
   * has a 0% mark-up, and that is a fact worth showing, not an empty cell. */
  showZero?: boolean;
}

/**
 * A numeric cell that holds what you typed while you're typing it.
 *
 * Without this, every keystroke round-trips through the sheet's arithmetic and
 * comes back rounded — so "0.5" becomes "0.5" then "0" the moment you type the
 * decimal point, and the VAT-inclusive field drifts by a cent as it converts
 * back and forth. The cell shows its own text while focused and the sheet's
 * number the rest of the time.
 */
function NumberCell({
  value,
  onCommit,
  rowIndex,
  col,
  className,
  title,
  ariaLabel,
  blank = false,
  showZero = false,
}: NumberCellProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // What this cell itself last wrote. Anything arriving in `value` that isn't
  // that came from somewhere else — Ctrl+D filling down, a paste landing on
  // the focused cell, "apply to all" repricing — and has to win over the
  // half-typed text, or the cell shows one number while the sheet holds
  // another.
  const ownWrite = useRef<number | null>(null);

  useEffect(() => {
    if (ownWrite.current !== null && value !== ownWrite.current) {
      ownWrite.current = null;
      setDraft(null);
    }
  }, [value]);

  const hide = blank || (value === 0 && !showZero);
  const shown = draft ?? (hide ? "" : String(value));

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      title={title}
      aria-label={ariaLabel}
      data-r={rowIndex}
      data-c={col}
      value={shown}
      onFocus={(e) => {
        ownWrite.current = value;
        setDraft(value === 0 && !showZero ? "" : String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const parsed = parseNumeric(e.target.value) ?? 0;
        ownWrite.current = parsed;
        setDraft(e.target.value);
        onCommit(parsed);
      }}
      onBlur={() => {
        ownWrite.current = null;
        setDraft(null);
      }}
    />
  );
}

interface JobSheetLinesGridProps {
  rows: SheetRow[];
  onChange: (rows: SheetRow[]) => void;
  financials: JobSheetFinancials;
  descriptionSuggestions?: string[];
  companyName?: string;
}

export function JobSheetLinesGrid({
  rows,
  onChange,
  financials,
  descriptionSuggestions,
  companyName = "",
}: JobSheetLinesGridProps) {
  const datalistId = useId();
  const bulkMarginId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const [bulkMargin, setBulkMargin] = useState("");
  // Set when a keystroke or paste adds rows, so focus can follow into a row
  // that doesn't exist yet at the time the key is handled.
  const pendingFocus = useRef<{ row: number; col: Col } | null>(null);

  const { costs: supplierCosts, ownerOf } = supplierCostByClientRow(rows);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    focusCell(target.row, target.col);
  });

  function focusCell(rowIndex: number, col: Col) {
    const el = gridRef.current?.querySelector<HTMLInputElement>(
      `[data-r="${rowIndex}"][data-c="${col}"]`,
    );
    if (el) {
      el.focus();
      el.select();
    }
  }

  function updateRow(index: number, patch: Partial<SheetRow>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    onChange([...rows, emptySheetRow()]);
  }

  function removeRow(index: number) {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [emptySheetRow()]);
  }

  /** Grows the sheet to at least `count` rows, returning the grown array. */
  function grownTo(current: SheetRow[], count: number): SheetRow[] {
    if (current.length >= count) return current;
    const next = [...current];
    while (next.length < count) next.push(emptySheetRow());
    return next;
  }

  function setCell(row: SheetRow, col: Col, raw: string): SheetRow {
    const numeric = parseNumeric(raw) ?? 0;
    switch (col) {
      case "clientDescription":
        return { ...row, clientDescription: raw };
      case "supplierDescription":
        return { ...row, supplierDescription: raw };
      case "vendorName":
        return { ...row, vendorName: raw };
      case "clientQty":
        return { ...row, clientQty: numeric };
      case "clientExcl":
        return { ...row, clientUnitCost: numeric };
      case "clientIncl":
        return { ...row, clientUnitCost: exclVat(numeric) };
      case "supplierQty":
        return { ...row, supplierQty: numeric };
      case "supplierExcl":
        return { ...row, supplierUnitCost: numeric };
      case "supplierIncl":
        return { ...row, supplierUnitCost: exclVat(numeric) };
      case "markup":
        return row; // repriced separately — it needs the row's supplier cost
    }
  }

  function readCell(row: SheetRow, col: Col): string {
    switch (col) {
      case "clientDescription":
        return row.clientDescription;
      case "supplierDescription":
        return row.supplierDescription;
      case "vendorName":
        return row.vendorName;
      case "clientQty":
        return String(row.clientQty);
      case "clientExcl":
        return String(row.clientUnitCost);
      case "clientIncl":
        return String(inclVat(row.clientUnitCost));
      case "supplierQty":
        return String(row.supplierQty);
      case "supplierExcl":
        return String(row.supplierUnitCost);
      case "supplierIncl":
        return String(inclVat(row.supplierUnitCost));
      case "markup":
        return "";
    }
  }

  function repriceRow(index: number, marginPct: number) {
    const supplierTotal = supplierCosts[index] ?? 0;
    const unitCost = clientUnitCostForMargin(supplierTotal, rows[index].clientQty, marginPct);
    if (unitCost === null) return;
    updateRow(index, { clientUnitCost: unitCost });
  }

  function repriceAll() {
    const marginPct = parseNumeric(bulkMargin);
    if (marginPct === null) return;
    onChange(
      rows.map((row, index) => {
        const unitCost = clientUnitCostForMargin(
          supplierCosts[index] ?? 0,
          row.clientQty,
          marginPct,
        );
        return unitCost === null ? row : { ...row, clientUnitCost: unitCost };
      }),
    );
  }

  const repriceableCount = rows.filter(
    (row, index) => row.clientQty > 0 && (supplierCosts[index] ?? 0) > 0,
  ).length;

  // --- keyboard -------------------------------------------------------------

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const rowAttr = target.getAttribute?.("data-r");
    const colAttr = target.getAttribute?.("data-c") as Col | null;
    if (rowAttr === null || !colAttr) return;

    const rowIndex = Number(rowAttr);
    const colIndex = COLS.indexOf(colAttr);
    const lastRow = rows.length - 1;

    const move = (row: number, col: Col) => {
      e.preventDefault();
      if (row > lastRow) {
        onChange(grownTo(rows, row + 1));
        pendingFocus.current = { row, col };
      } else {
        focusCell(row, col);
      }
    };

    if (e.key === "ArrowDown") return move(rowIndex + 1, colAttr);
    if (e.key === "ArrowUp") return rowIndex > 0 ? move(rowIndex - 1, colAttr) : undefined;
    if (e.key === "Enter") return move(rowIndex + 1, colAttr);

    if (e.key === "Tab" && !e.shiftKey && colIndex === COLS.length - 1 && rowIndex === lastRow) {
      // Tabbing off the last cell of the last row continues into a new one,
      // rather than jumping out of the sheet.
      return move(rowIndex + 1, COLS[0]);
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      if (rowIndex === 0) return;
      const above = rows[rowIndex - 1];
      onChange(rows.map((r, i) => (i === rowIndex ? setCell(r, colAttr, readCell(above, colAttr)) : r)));
      return;
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const rowAttr = target.getAttribute?.("data-r");
    const colAttr = target.getAttribute?.("data-c") as Col | null;
    if (rowAttr === null || !colAttr) return;

    const text = e.clipboardData.getData("text/plain");
    if (!text) return;

    const grid = parseClipboardGrid(text);
    // A single cell with no tabs or newlines is an ordinary paste — let the
    // browser put it in the field the user is actually in.
    if (grid.length === 1 && grid[0].length === 1) return;

    e.preventDefault();

    const startRow = Number(rowAttr);
    const startCol = COLS.indexOf(colAttr);
    let next = grownTo(rows, startRow + grid.length);

    grid.forEach((line, r) => {
      const rowIndex = startRow + r;
      let row = next[rowIndex];
      line.forEach((value, c) => {
        const col = COLS[startCol + c];
        if (!col) return; // pasted wider than the sheet — drop the overflow
        row = setCell(row, col, value.trim());
      });
      next = next.map((existing, i) => (i === rowIndex ? row : existing));
    });

    onChange(next);
  }

  // --- totals ---------------------------------------------------------------

  const feeLabel = companyName === "Tuscany SA" ? "Silent partner 10%" : "NSA 10%";
  const feeAmount = companyName === "Tuscany SA" ? financials.tuscanyFee : financials.nsaFee;
  const money = (n: number) => `R ${n.toFixed(2)}`;

  return (
    <div className="sheet">
      <div className="sheet-toolbar">
        <h3>Job lines</h3>
        <div className="sheet-toolbar-actions">
          <label htmlFor={bulkMarginId}>Price every line at</label>
          <input
            id={bulkMarginId}
            type="text"
            inputMode="decimal"
            className="sheet-bulk-input"
            placeholder="%"
            value={bulkMargin}
            onChange={(e) => setBulkMargin(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={repriceAll}
            disabled={repriceableCount === 0 || parseNumeric(bulkMargin) === null}
          >
            Apply
          </button>
          <button type="button" className="btn-secondary" onClick={addRow}>
            + Row
          </button>
        </div>
      </div>

      {descriptionSuggestions && descriptionSuggestions.length > 0 && (
        <datalist id={datalistId}>
          {descriptionSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}

      <div className="sheet-scroll">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div className="sheet-grid" ref={gridRef} onKeyDown={handleKeyDown} onPaste={handlePaste}>
          <div className="sheet-row sheet-row-group">
            <span className="sheet-gutter" />
            <span className="sheet-group sheet-group-client">CLIENT</span>
            <span className="sheet-group sheet-group-supplier">COMPANY EXPENSES</span>
            <span className="sheet-actions-head" />
          </div>

          <div className="sheet-row sheet-row-head">
            <span className="sheet-gutter" />
            <span>DESCRIPTION</span>
            <span className="num">QTY</span>
            <span className="num">UNIT COST EXCL. VAT</span>
            <span className="num">INCL. VAT</span>
            <span className="num">CE TOTAL</span>
            <span className="num">MARK-UP</span>
            <span>SUPPLIER ITEMS</span>
            <span className="num">QTY</span>
            <span className="num">CE UNIT COST</span>
            <span className="num">INCL. VAT</span>
            <span className="num">CE TOTAL</span>
            <span>SUPPLIER NAME</span>
            <span className="sheet-actions-head" />
          </div>

          {rows.map((row, index) => {
            const clientTotal = round2(row.clientQty * row.clientUnitCost);
            const supplierTotal = round2(row.supplierQty * row.supplierUnitCost);
            const ownedCost = supplierCosts[index] ?? 0;
            const markup = rowHasClient(row) ? marginPctFromTotals(clientTotal, ownedCost) : null;
            const canReprice = row.clientQty > 0 && ownedCost > 0;
            // A cost rolled up into the client line above it rather than
            // priced on its own. Marked in the gutter so the grouping is
            // visible: which costs sit against which line changes what the
            // mark-up column says, and guessing at it is how a line ends up
            // reading -2420%.
            const isRolledUp = !rowHasClient(row) && ownerOf[index] >= 0;
            // A cost belonging to no client line at all — an unbilled job
            // overhead. Counts in full towards the sheet's expenses.
            const isUnattributed = !rowHasClient(row) && rowHasSupplier(row) && ownerOf[index] < 0;

            return (
              <div className="sheet-row" key={row.id}>
                <span
                  className={`sheet-gutter${isRolledUp ? " sheet-gutter-rolled" : ""}`}
                  title={
                    isRolledUp
                      ? `Costed against row ${ownerOf[index] + 1}. Leave a blank row above to separate it.`
                      : isUnattributed
                        ? "Counts towards expenses but not against any one line's mark-up"
                        : undefined
                  }
                >
                  {isRolledUp ? "↳" : index + 1}
                </span>

                <input
                  type="text"
                  list={datalistId}
                  aria-label={`Row ${index + 1} client description`}
                  data-r={index}
                  data-c="clientDescription"
                  value={row.clientDescription}
                  onChange={(e) => updateRow(index, { clientDescription: e.target.value })}
                />
                <NumberCell
                  className="num"
                  ariaLabel={`Row ${index + 1} client quantity`}
                  rowIndex={index}
                  col="clientQty"
                  value={row.clientQty}
                  blank={!rowHasClient(row)}
                  onCommit={(v) => updateRow(index, { clientQty: v })}
                />
                <NumberCell
                  className="num"
                  ariaLabel={`Row ${index + 1} client unit price excluding VAT`}
                  rowIndex={index}
                  col="clientExcl"
                  value={row.clientUnitCost}
                  onCommit={(v) => updateRow(index, { clientUnitCost: v })}
                />
                <NumberCell
                  className="num derived"
                  title="Type whichever price you have — the other works itself out"
                  ariaLabel={`Row ${index + 1} client unit price including VAT`}
                  rowIndex={index}
                  col="clientIncl"
                  value={inclVat(row.clientUnitCost)}
                  blank={!rowHasClient(row)}
                  onCommit={(v) => updateRow(index, { clientUnitCost: exclVat(v) })}
                />
                <span className="sheet-total">{clientTotal ? clientTotal.toFixed(2) : ""}</span>

                {canReprice ? (
                  <NumberCell
                    className="num sheet-markup"
                    title="Type a margin to price this line backwards from its supplier cost"
                    ariaLabel={`Row ${index + 1} mark-up percent`}
                    rowIndex={index}
                    col="markup"
                    value={markup ?? 0}
                    showZero
                    onCommit={(v) => repriceRow(index, v)}
                  />
                ) : (
                  <span
                    className="sheet-markup sheet-markup-static"
                    title={
                      isRolledUp
                        ? `Costed against row ${ownerOf[index] + 1}`
                        : isUnattributed
                          ? "Not billed to the client — counts towards expenses only"
                          : "Needs a client quantity and a supplier cost"
                    }
                  >
                    {markup === null ? "" : `${markup.toFixed(0)}%`}
                  </span>
                )}

                <div className="sheet-supplier-desc">
                  <input
                    type="text"
                    list={datalistId}
                    aria-label={`Row ${index + 1} supplier item`}
                    data-r={index}
                    data-c="supplierDescription"
                    value={row.supplierDescription}
                    onChange={(e) => updateRow(index, { supplierDescription: e.target.value })}
                  />
                  {row.supplierDescription.trim() !== "" && row.clientDescription.trim() === "" && (
                    <button
                      type="button"
                      className="sheet-copy-across"
                      tabIndex={-1}
                      title="Use this as the client description too"
                      onClick={() =>
                        updateRow(index, { clientDescription: row.supplierDescription })
                      }
                    >
                      ←
                    </button>
                  )}
                </div>
                <NumberCell
                  className="num"
                  ariaLabel={`Row ${index + 1} supplier quantity`}
                  rowIndex={index}
                  col="supplierQty"
                  value={row.supplierQty}
                  blank={!rowHasSupplier(row)}
                  onCommit={(v) => updateRow(index, { supplierQty: v })}
                />
                <NumberCell
                  className="num"
                  ariaLabel={`Row ${index + 1} supplier unit cost excluding VAT`}
                  rowIndex={index}
                  col="supplierExcl"
                  value={row.supplierUnitCost}
                  onCommit={(v) => updateRow(index, { supplierUnitCost: v })}
                />
                <NumberCell
                  className="num derived"
                  title="Type whichever cost you have — the other works itself out"
                  ariaLabel={`Row ${index + 1} supplier unit cost including VAT`}
                  rowIndex={index}
                  col="supplierIncl"
                  value={inclVat(row.supplierUnitCost)}
                  blank={!rowHasSupplier(row)}
                  onCommit={(v) => updateRow(index, { supplierUnitCost: exclVat(v) })}
                />
                <span className="sheet-total">{supplierTotal ? supplierTotal.toFixed(2) : ""}</span>
                <input
                  type="text"
                  aria-label={`Row ${index + 1} supplier name`}
                  data-r={index}
                  data-c="vendorName"
                  value={row.vendorName}
                  onChange={(e) => updateRow(index, { vendorName: e.target.value })}
                />

                <button
                  type="button"
                  className="sheet-remove"
                  tabIndex={-1}
                  aria-label={`Delete row ${index + 1}`}
                  title="Delete this row"
                  onClick={() => removeRow(index)}
                >
                  ×
                </button>
              </div>
            );
          })}

          {/* The two lines the Excel types by hand into the supplier list. Here
              they are worked out, so they can't be forgotten or mistyped — but
              they sit where the spreadsheet puts them. */}
          {financials.sibanyeRebate > 0 && (
            <div className="sheet-row sheet-row-auto">
              <span className="sheet-gutter" />
              <span className="sheet-auto-spacer" />
              <span>Sibanye 2.5%</span>
              <span className="sheet-auto-gap" />
              <span className="sheet-total">{financials.sibanyeRebate.toFixed(2)}</span>
              <span className="sheet-auto-note">2.5% of the incl. VAT total</span>
            </div>
          )}
          {feeAmount !== 0 && (
            <div className="sheet-row sheet-row-auto">
              <span className="sheet-gutter" />
              <span className="sheet-auto-spacer" />
              <span>{feeLabel}</span>
              <span className="sheet-auto-gap" />
              <span className="sheet-total">{feeAmount.toFixed(2)}</span>
              <span className="sheet-auto-note">10% of profit</span>
            </div>
          )}
        </div>
      </div>

      <div className="sheet-footer">
        <dl className="sheet-footer-block sheet-footer-client">
          <div>
            <dt>Sub Total:</dt>
            <dd>{money(financials.clientSubtotal)}</dd>
          </div>
          <div>
            <dt>Vat @ 15%</dt>
            <dd>{money(financials.vatAmount)}</dd>
          </div>
          <div className="sheet-footer-strong">
            <dt>Total (Incl Vat)</dt>
            <dd>{money(financials.clientTotal)}</dd>
          </div>
        </dl>

        <dl className="sheet-footer-block sheet-footer-supplier">
          <div>
            <dt>Total Expenses:</dt>
            <dd>{money(financials.totalCosts)}</dd>
          </div>
          <div className="sheet-footer-strong">
            <dt>Profit:</dt>
            <dd>{money(financials.netProfit)}</dd>
          </div>
          <div className="sheet-footer-strong">
            <dt>Profit Margin</dt>
            <dd>{financials.netMarginPct.toFixed(2)}%</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
