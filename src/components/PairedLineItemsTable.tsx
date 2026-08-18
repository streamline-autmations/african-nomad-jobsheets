import { useId, useState } from "react";
import { MARGIN_TARGET_PCT, exclVat, inclVat, round2 } from "../lib/feeCalculations";
import { marginPctFromTotals, repriceRowToMargin } from "../lib/markup";
import { emptyPairedRow, type PairedRow } from "../lib/pairedLineItems";

interface PairedLineItemsTableProps {
  rows: PairedRow[];
  onChange: (rows: PairedRow[]) => void;
  descriptionSuggestions?: string[];
}

// Mirrors the real spreadsheet's layout: one row per line, client price and
// supplier cost side by side, with the markup between them shown live —
// instead of two separate stacked tables like the app used to have.
export function PairedLineItemsTable({
  rows,
  onChange,
  descriptionSuggestions,
}: PairedLineItemsTableProps) {
  const datalistId = useId();
  const bulkMarginId = useId();
  // Held as a string so the field can be empty or mid-typing ("2", "2.") without
  // snapping back to a number on every keystroke.
  const [bulkMargin, setBulkMargin] = useState(String(MARGIN_TARGET_PCT));

  function updateRow(id: string, patch: Partial<PairedRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // Prices a line backwards from a target margin instead of forwards from a
  // price — the fast path when a mine wants a number now and the supplier
  // cost is the only thing actually known.
  function repriceRow(id: string, marginPct: number) {
    onChange(rows.map((r) => (r.id === id ? repriceRowToMargin(r, marginPct) : r)));
  }

  function repriceAll() {
    const marginPct = Number(bulkMargin);
    if (!Number.isFinite(marginPct)) return;
    onChange(rows.map((r) => repriceRowToMargin(r, marginPct)));
  }

  // Rows repriceRowToMargin would decline to touch (no cost, or no client qty).
  // Counted so "apply to all" can say what it skipped instead of silently
  // leaving lines at whatever was typed.
  const skippedByReprice = rows.filter(
    (r) => r.clientQty <= 0 || round2(r.supplierQty * r.supplierUnitCost) <= 0,
  ).length;
  function removeRow(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }
  function addRow() {
    onChange([...rows, emptyPairedRow()]);
  }

  const clientSubtotal = round2(
    rows.reduce((sum, r) => sum + round2(r.clientQty * r.clientUnitCost), 0),
  );
  const supplierSubtotal = round2(
    rows.reduce((sum, r) => sum + round2(r.supplierQty * r.supplierUnitCost), 0),
  );

  return (
    <div className="paired-line-items">
      <div className="line-items-header">
        <div>
          <h3>Job lines</h3>
          <p className="section-description">
            One row per item. Fill in the <strong>client</strong> side for what you're charging,
            the <strong>supplier</strong> side for what it costs you — or just one side if a line
            is pure margin (no tracked cost) or a cost that isn't billed to the client separately
            (e.g. bulk printing folded into markup elsewhere). Each price has an excl. and incl.
            VAT field — type whichever one you actually have, and the other fills itself in.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={addRow}>
          + Add line
        </button>
      </div>

      <div className="bulk-markup">
        <label htmlFor={bulkMarginId}>Price every line at</label>
        <input
          id={bulkMarginId}
          type="number"
          step="1"
          max={99}
          className="bulk-markup-input"
          value={bulkMargin}
          onChange={(e) => setBulkMargin(e.target.value)}
        />
        <span aria-hidden="true">%</span>
        <button
          type="button"
          className="btn-secondary"
          onClick={repriceAll}
          disabled={rows.length === 0 || rows.length === skippedByReprice}
        >
          Apply to all lines
        </button>
        <span className="bulk-markup-note">
          Sets each client price from its supplier cost.
          {skippedByReprice > 0 &&
            ` ${skippedByReprice} line${skippedByReprice === 1 ? "" : "s"} will be skipped — no supplier cost or client qty yet.`}
        </span>
      </div>

      {descriptionSuggestions && descriptionSuggestions.length > 0 && (
        <datalist id={datalistId}>
          {descriptionSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}

      <div className="paired-table" role="table">
        <div className="paired-row paired-row-head" role="row">
          <span role="columnheader">Description</span>
          <div className="paired-cell paired-client-cell paired-cell-head" role="columnheader">
            <span className="paired-group-label">Client — what you charge</span>
            <span>Qty</span>
            <span title="What you charge per unit, before VAT">Price excl. VAT</span>
            <span title="Fill in either price field — the other one works itself out">
              Price incl. VAT
            </span>
            <span>Total</span>
          </div>
          <div className="paired-cell paired-supplier-cell paired-cell-head" role="columnheader">
            <span className="paired-group-label">Supplier — what it costs you</span>
            <span>Vendor</span>
            <span>Qty</span>
            <span title="What the supplier charges per unit, before VAT">Cost excl. VAT</span>
            <span title="Fill in either cost field — the other one works itself out">
              Cost incl. VAT
            </span>
            <span>Total</span>
          </div>
          <span role="columnheader" title="Profit margin on this line">
            Markup
          </span>
          <span role="columnheader" aria-label="Remove" />
        </div>

        {rows.map((row) => {
          const clientTotal = round2(row.clientQty * row.clientUnitCost);
          const supplierTotal = round2(row.supplierQty * row.supplierUnitCost);
          const markup = marginPctFromTotals(clientTotal, supplierTotal);
          // A row with no cost, or no client qty, can't be priced from a
          // margin — see clientUnitCostForMargin for why.
          const canReprice = row.clientQty > 0 && supplierTotal > 0;

          return (
            <div className="paired-row" role="row" key={row.id}>
              <input
                type="text"
                value={row.description}
                placeholder="e.g. Lanyard"
                aria-label="Description"
                list={descriptionSuggestions ? datalistId : undefined}
                onChange={(e) => updateRow(row.id, { description: e.target.value })}
              />

              <div className="paired-cell paired-client-cell">
                <input
                  type="number"
                  min={0}
                  step="1"
                  placeholder="0"
                  aria-label="Client quantity"
                  value={row.clientQty}
                  onChange={(e) => updateRow(row.id, { clientQty: Number(e.target.value) || 0 })}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  aria-label="Client price per unit, excl. VAT"
                  value={row.clientUnitCost}
                  onChange={(e) =>
                    updateRow(row.id, { clientUnitCost: Number(e.target.value) || 0 })
                  }
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  aria-label="Client price per unit, incl. VAT"
                  value={inclVat(row.clientUnitCost)}
                  onChange={(e) => {
                    const typed = Number(e.target.value);
                    updateRow(row.id, {
                      clientUnitCost: Number.isFinite(typed) ? exclVat(typed) : 0,
                    });
                  }}
                />
                <span className="line-total">R {clientTotal.toFixed(2)}</span>
              </div>

              <div className="paired-cell paired-supplier-cell">
                <input
                  type="text"
                  placeholder="Supplier name"
                  aria-label="Vendor"
                  value={row.vendorName}
                  onChange={(e) => updateRow(row.id, { vendorName: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  step="1"
                  placeholder="0"
                  aria-label="Supplier quantity"
                  value={row.supplierQty}
                  onChange={(e) => updateRow(row.id, { supplierQty: Number(e.target.value) || 0 })}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  aria-label="Supplier cost per unit, excl. VAT"
                  value={row.supplierUnitCost}
                  onChange={(e) =>
                    updateRow(row.id, { supplierUnitCost: Number(e.target.value) || 0 })
                  }
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  aria-label="Supplier cost per unit, incl. VAT"
                  value={inclVat(row.supplierUnitCost)}
                  onChange={(e) => {
                    const typed = Number(e.target.value);
                    updateRow(row.id, {
                      supplierUnitCost: Number.isFinite(typed) ? exclVat(typed) : 0,
                    });
                  }}
                />
                <span className="line-total">R {supplierTotal.toFixed(2)}</span>
              </div>

              {canReprice ? (
                <input
                  type="number"
                  step="1"
                  max={99}
                  className={`paired-markup-input ${
                    markup !== null && markup < MARGIN_TARGET_PCT ? "margin-flag" : ""
                  }`}
                  aria-label={`Markup for ${row.description || "line"}`}
                  title="Type a % to price this line from its supplier cost"
                  value={markup === null ? "" : markup.toFixed(0)}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next)) repriceRow(row.id, next);
                  }}
                />
              ) : (
                <span
                  className={`paired-markup ${
                    markup !== null && markup < MARGIN_TARGET_PCT ? "margin-flag" : ""
                  }`}
                  title={
                    markup === null
                      ? "Add a client price to see the margin on this line"
                      : "Add a supplier cost to price this line from a markup %"
                  }
                >
                  {markup === null ? "—" : `${markup.toFixed(0)}%`}
                </span>
              )}

              <button
                type="button"
                className="btn-icon"
                aria-label={`Remove ${row.description || "line"}`}
                onClick={() => removeRow(row.id)}
              >
                &times;
              </button>
            </div>
          );
        })}

        {rows.length === 0 && <p className="line-items-empty">No lines yet — add one above.</p>}
      </div>

      <div className="paired-subtotals">
        <span>
          Client subtotal <strong>R {clientSubtotal.toFixed(2)}</strong>
        </span>
        <span>
          Supplier / expense subtotal <strong>R {supplierSubtotal.toFixed(2)}</strong>
        </span>
      </div>
    </div>
  );
}
