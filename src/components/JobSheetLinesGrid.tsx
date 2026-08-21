import { useEffect, useId, useMemo, useRef, useState } from "react";
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

/**
 * Where a pasted block lands, in visual order.
 *
 * Only the columns a person types into. The VAT-inclusive fields, both CE
 * TOTAL columns and MARK-UP are all worked out by the sheet, so pasting into
 * them would either be overwritten immediately or reprice the line — and
 * consuming a clipboard position for them would shift every column after it.
 * The rule is simple enough to say out loud: paste fills the columns you would
 * have typed, starting at the cell you are in.
 */
const PASTE_COLS = [
  "clientDescription",
  "clientQty",
  "clientExcl",
  "supplierDescription",
  "supplierQty",
  "supplierExcl",
  "vendorName",
] as const;

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
  // Whether the change now arriving in `value` was caused by this cell's own
  // keystroke. Anything else — Ctrl+D filling down, a paste landing on the
  // focused cell, "apply to all" repricing — has to win over the half-typed
  // text, or the cell shows one number while the sheet holds another.
  //
  // Tracked by origin rather than by comparing numbers, because a derived cell
  // legitimately echoes back something other than what was typed: enter 100.01
  // in a VAT-inclusive field and it returns 100.02 once it has been through
  // exclVat/inclVat. Comparing values would read that as an external edit and
  // wipe the field mid-keystroke.
  const selfEdit = useRef(false);

  useEffect(() => {
    if (selfEdit.current) {
      selfEdit.current = false;
      return;
    }
    setDraft(null);
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
        setDraft(value === 0 && !showZero ? "" : String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        selfEdit.current = true;
        setDraft(e.target.value);
        onCommit(parseNumeric(e.target.value) ?? 0);
      }}
      onBlur={() => {
        selfEdit.current = false;
        setDraft(null);
      }}
    />
  );
}

/** A candidate the description autocomplete can offer. `qty` is known when
 * the suggestion came from a row already on the sheet — offered from the
 * common-expenses list, it isn't, and picking it fills the description only. */
interface Suggestion {
  description: string;
  qty: number | null;
}

interface Candidate extends Suggestion {
  qty: number;
  rowIndex: number;
}

function candidatesFrom(
  rows: SheetRow[],
  get: (row: SheetRow) => { desc: string; qty: number },
): Candidate[] {
  return rows
    .map((row, rowIndex) => ({ ...get(row), rowIndex }))
    .filter((c) => c.desc.trim() !== "")
    .map((c) => ({ description: c.desc.trim(), qty: c.qty, rowIndex: c.rowIndex }));
}

/** First occurrence wins, case-insensitively — so a match found on the
 * opposite side of the sheet (the one most worth surfacing) isn't shadowed
 * by a same-side or history match spelled the same way. */
function dedupeSuggestions<T extends Suggestion>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    const key = item.description.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

interface DescriptionCellProps {
  value: string;
  rowIndex: number;
  col: "clientDescription" | "supplierDescription";
  ariaLabel: string;
  suggestions: Suggestion[];
  onChangeText: (text: string) => void;
  /** Fills the description and, when the suggestion carries one, the
   * quantity too — the whole point being that adding "Powerbanks" on one
   * side and then typing "pow" on the other reproduces both fields. */
  onPick: (suggestion: Suggestion) => void;
}

/**
 * A description cell with a live typeahead sourced from the rest of this job
 * sheet (either side) plus the common-expenses list.
 *
 * Not a `<datalist>`: picking a browser datalist option can only set the
 * text, and the whole reason this exists is to carry the quantity across
 * with it. Arrow keys and Enter are only taken over while suggestions are
 * actually showing, so the grid's own cell-to-cell navigation is untouched
 * the rest of the time.
 */
function DescriptionCell({
  value,
  rowIndex,
  col,
  ariaLabel,
  suggestions,
  onChangeText,
  onPick,
}: DescriptionCellProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const query = value.trim().toLowerCase();
  const filtered =
    query === ""
      ? []
      : suggestions
          .filter((s) => s.description.toLowerCase().includes(query))
          .sort((a, b) => {
            const aStarts = a.description.toLowerCase().startsWith(query) ? 0 : 1;
            const bStarts = b.description.toLowerCase().startsWith(query) ? 0 : 1;
            return aStarts - bStarts || a.description.localeCompare(b.description);
          })
          .slice(0, 8);

  const showDropdown = open && filtered.length > 0;

  function pick(s: Suggestion) {
    onPick(s);
    setOpen(false);
    setHighlight(-1);
  }

  return (
    <div className="sheet-desc-cell">
      <input
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        data-r={rowIndex}
        data-c={col}
        value={value}
        onChange={(e) => {
          onChangeText(e.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // A click on a suggestion fires its own mousedown handler first —
          // this just has to outlive that before it hides the list.
          window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(e) => {
          if (!showDropdown) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            setHighlight((h) => (h + 1) % filtered.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            setHighlight((h) => (h <= 0 ? filtered.length - 1 : h - 1));
          } else if (e.key === "Enter" && highlight >= 0) {
            e.preventDefault();
            e.stopPropagation();
            pick(filtered[highlight]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
            setHighlight(-1);
          }
        }}
      />
      {showDropdown && (
        <ul className="sheet-suggestions" role="listbox">
          {filtered.map((s, i) => (
            <li
              key={s.description}
              role="option"
              aria-selected={i === highlight}
              className={i === highlight ? "sheet-suggestion-active" : undefined}
              onMouseDown={(e) => {
                // Beats the input's onBlur, which fires first on a mouseup-based click.
                e.preventDefault();
                pick(s);
              }}
            >
              <span>{s.description}</span>
              {s.qty !== null && <span className="sheet-suggestion-qty">qty {s.qty}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const bulkMarginId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const [bulkMargin, setBulkMargin] = useState("");
  // Set when a keystroke or paste adds rows, so focus can follow into a row
  // that doesn't exist yet at the time the key is handled.
  const pendingFocus = useRef<{ row: number; col: Col } | null>(null);

  const { costs: supplierCosts, ownerOf } = supplierCostByClientRow(rows);

  // Autocomplete sources: every client line, every supplier line, and the
  // common-expenses list — kept separate so a suggestion from the *opposite*
  // side of the sheet (the useful one, carrying a quantity) can be ranked
  // ahead of a same-side or history match spelled the same way.
  const clientCandidates = useMemo(
    () => candidatesFrom(rows, (row) => ({ desc: row.clientDescription, qty: row.clientQty })),
    [rows],
  );
  const supplierCandidates = useMemo(
    () => candidatesFrom(rows, (row) => ({ desc: row.supplierDescription, qty: row.supplierQty })),
    [rows],
  );
  const historyCandidates: Suggestion[] = useMemo(
    () => (descriptionSuggestions ?? []).map((description) => ({ description, qty: null })),
    [descriptionSuggestions],
  );

  function suggestionsFor(side: "client" | "supplier", rowIndex: number): Suggestion[] {
    const opposite = side === "client" ? supplierCandidates : clientCandidates;
    // The row being typed into still counts on its own side — its
    // in-progress text isn't useful as a suggestion for itself.
    const sameSide = (side === "client" ? clientCandidates : supplierCandidates).filter(
      (c) => c.rowIndex !== rowIndex,
    );
    return dedupeSuggestions<Suggestion>([...opposite, ...sameSide, ...historyCandidates]);
  }

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
      if (colAttr === "markup") {
        // Mark-up isn't a stored field, so copying it means repricing this row
        // to the margin the row above is running at.
        const above = rows[rowIndex - 1];
        const aboveMargin = marginPctFromTotals(
          round2(above.clientQty * above.clientUnitCost),
          supplierCosts[rowIndex - 1] ?? 0,
        );
        if (aboveMargin !== null) repriceRow(rowIndex, aboveMargin);
        return;
      }
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
    // A paste starting on a derived column begins at the next typed column
    // instead, rather than silently going nowhere.
    const startCol = Math.max(
      0,
      (PASTE_COLS as readonly string[]).indexOf(colAttr) === -1
        ? (PASTE_COLS as readonly string[]).findIndex(
            (c) => COLS.indexOf(c as Col) > COLS.indexOf(colAttr),
          )
        : (PASTE_COLS as readonly string[]).indexOf(colAttr),
    );
    let next = grownTo(rows, startRow + grid.length);

    grid.forEach((line, r) => {
      const rowIndex = startRow + r;
      let row = next[rowIndex];
      line.forEach((value, c) => {
        const col = PASTE_COLS[startCol + c];
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

      {/* The one thing that isn't discoverable by looking. Everything else on
          this grid behaves the way a spreadsheet does. */}
      <p className="sheet-hint">
        Paste straight from Excel — description, qty and cost fill down from
        wherever you are. Enter and the arrows move, Ctrl+D copies from above.
      </p>

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

                <DescriptionCell
                  value={row.clientDescription}
                  rowIndex={index}
                  col="clientDescription"
                  ariaLabel={`Row ${index + 1} client description`}
                  suggestions={suggestionsFor("client", index)}
                  onChangeText={(text) => updateRow(index, { clientDescription: text })}
                  onPick={(s) =>
                    updateRow(index, {
                      clientDescription: s.description,
                      ...(s.qty !== null ? { clientQty: s.qty } : {}),
                    })
                  }
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
                  <DescriptionCell
                    value={row.supplierDescription}
                    rowIndex={index}
                    col="supplierDescription"
                    ariaLabel={`Row ${index + 1} supplier item`}
                    suggestions={suggestionsFor("supplier", index)}
                    onChangeText={(text) => updateRow(index, { supplierDescription: text })}
                    onPick={(s) =>
                      updateRow(index, {
                        supplierDescription: s.description,
                        ...(s.qty !== null ? { supplierQty: s.qty } : {}),
                      })
                    }
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
