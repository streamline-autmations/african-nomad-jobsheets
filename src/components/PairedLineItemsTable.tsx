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
        <h3>Job lines — client price &amp; supplier cost side by side</h3>
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
          <span role="columnheader" className="paired-group-head">
            Client
          </span>
          <span role="columnheader" className="paired-group-head">
            Supplier / Expense
          </span>
          <span role="columnheader">Markup</span>
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
                placeholder="Description"
                list={descriptionSuggestions ? datalistId : undefined}
                onChange={(e) => updateRow(row.id, { description: e.target.value })}
              />

              <div className="paired-cell paired-client-cell">
                <input
                  type="number"
                  min={0}
                  step="1"
                  placeholder="Qty"
                  value={row.clientQty}
                  onChange={(e) => updateRow(row.id, { clientQty: Number(e.target.value) || 0 })}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Client price"
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
                  placeholder="Vendor"
                  value={row.vendorName}
                  onChange={(e) => updateRow(row.id, { vendorName: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  step="1"
                  placeholder="Qty"
                  value={row.supplierQty}
                  onChange={(e) => updateRow(row.id, { supplierQty: Number(e.target.value) || 0 })}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Cost"
                  value={row.supplierUnitCost}
                  onChange={(e) =>
                    updateRow(row.id, { supplierUnitCost: Number(e.target.value) || 0 })
                  }
                />
                <span className="line-total">R {supplierTotal.toFixed(2)}</span>
              </div>

              <span className={markup !== null && markup < 20 ? "margin-flag" : ""}>
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
          Client subtotal: <strong>R {clientSubtotal.toFixed(2)}</strong>
        </span>
        <span>
          Supplier / expense subtotal: <strong>R {supplierSubtotal.toFixed(2)}</strong>
        </span>
      </div>
    </div>
  );
}
