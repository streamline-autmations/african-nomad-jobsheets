import { useId } from "react";
import { round2 } from "../lib/feeCalculations";
import type { LineItemInput } from "../types";

interface LineItemsTableProps {
  title: string;
  lines: LineItemInput[];
  onChange: (lines: LineItemInput[]) => void;
  descriptionSuggestions?: string[];
  /** Shows a Vendor column and requires it — used for expense lines, which
   * need a real QuickBooks Vendor to post as a Bill against. */
  showVendor?: boolean;
}

function newLine(): LineItemInput {
  return {
    id: crypto.randomUUID(),
    description: "",
    qty: 1,
    unitCost: 0,
  };
}

export function LineItemsTable({
  title,
  lines,
  onChange,
  descriptionSuggestions,
  showVendor,
}: LineItemsTableProps) {
  const datalistId = useId();
  const subtotal = round2(
    lines.reduce((sum, line) => sum + round2(line.qty * line.unitCost), 0),
  );

  function updateLine(id: string, patch: Partial<LineItemInput>) {
    onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function removeLine(id: string) {
    onChange(lines.filter((line) => line.id !== id));
  }

  function addLine() {
    onChange([...lines, newLine()]);
  }

  return (
    <div className="line-items">
      <div className="line-items-header">
        <h3>{title}</h3>
        <button type="button" className="btn-secondary" onClick={addLine}>
          + Add line
        </button>
      </div>

      {descriptionSuggestions && descriptionSuggestions.length > 0 && (
        <datalist id={datalistId}>
          {descriptionSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}

      <div
        className={`line-items-table${showVendor ? " line-items-table-with-vendor" : ""}`}
        role="table"
      >
        <div className="line-items-row line-items-row-head" role="row">
          <span role="columnheader">Description</span>
          {showVendor && <span role="columnheader">Vendor</span>}
          <span role="columnheader">Qty</span>
          <span role="columnheader">Unit cost</span>
          <span role="columnheader">Line total</span>
          <span role="columnheader" aria-label="Remove" />
        </div>

        {lines.map((line) => (
          <div className="line-items-row" role="row" key={line.id}>
            <input
              type="text"
              value={line.description}
              placeholder="Description"
              list={descriptionSuggestions ? datalistId : undefined}
              onChange={(e) => updateLine(line.id, { description: e.target.value })}
            />
            {showVendor && (
              <input
                type="text"
                value={line.vendorName ?? ""}
                placeholder="Supplier name"
                onChange={(e) => updateLine(line.id, { vendorName: e.target.value })}
              />
            )}
            <input
              type="number"
              min={0}
              step="1"
              value={line.qty}
              onChange={(e) =>
                updateLine(line.id, { qty: Number(e.target.value) || 0 })
              }
            />
            <input
              type="number"
              min={0}
              step="0.01"
              value={line.unitCost}
              onChange={(e) =>
                updateLine(line.id, { unitCost: Number(e.target.value) || 0 })
              }
            />
            <span className="line-total">
              R {round2(line.qty * line.unitCost).toFixed(2)}
            </span>
            <button
              type="button"
              className="btn-icon"
              aria-label={`Remove ${line.description || "line"}`}
              onClick={() => removeLine(line.id)}
            >
              &times;
            </button>
          </div>
        ))}

        {lines.length === 0 && (
          <p className="line-items-empty">No lines yet — add one above.</p>
        )}
      </div>

      <div className="line-items-subtotal">
        Subtotal: <strong>R {subtotal.toFixed(2)}</strong>
      </div>
    </div>
  );
}
