import { useId } from "react";
import { round2 } from "../lib/feeCalculations";
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

  function updateRow(id: string, patch: Partial<PairedRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
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
            (e.g. bulk printing folded into markup elsewhere).
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={addRow}>
          + Add line
        </button>
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
            <span>Price</span>
            <span>Total</span>
          </div>
          <div className="paired-cell paired-supplier-cell paired-cell-head" role="columnheader">
            <span className="paired-group-label">Supplier — what it costs you</span>
            <span>Vendor</span>
            <span>Qty</span>
            <span>Cost</span>
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
          const markup =
            clientTotal > 0 ? round2(((clientTotal - supplierTotal) / clientTotal) * 100) : null;

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
                  aria-label="Client price per unit"
                  value={row.clientUnitCost}
                  onChange={(e) =>
                    updateRow(row.id, { clientUnitCost: Number(e.target.value) || 0 })
                  }
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
                  aria-label="Supplier cost per unit"
                  value={row.supplierUnitCost}
                  onChange={(e) =>
                    updateRow(row.id, { supplierUnitCost: Number(e.target.value) || 0 })
                  }
                />
                <span className="line-total">R {supplierTotal.toFixed(2)}</span>
              </div>

              <span
                className={`paired-markup ${markup !== null && markup < 20 ? "margin-flag" : ""}`}
                title="(Client total − supplier total) ÷ client total"
              >
                {markup === null ? "—" : `${markup.toFixed(0)}%`}
              </span>

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
