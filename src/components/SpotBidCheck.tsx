import { useId, useState } from "react";
import { round2 } from "../lib/feeCalculations";
import { maxSupplierTotalForMargin } from "../lib/markup";

interface SpotBidCheckProps {
  /** What the job currently costs from suppliers — job sheet's expense total. */
  expenseTotal: number;
}

/**
 * Answers the question a mine actually asks: "we need this for around R X —
 * can you do it?"
 *
 * The rest of the form works forwards (costs -> price -> margin). This works
 * backwards from the price the client named, which is the shape of a spot bid
 * or a "what's your best number" call, where the price is the fixed input and
 * the question is whether the job can be bought for less.
 */
export function SpotBidCheck({ expenseTotal }: SpotBidCheckProps) {
  // Strings, so the fields can be empty or mid-typing without snapping.
  const [targetPrice, setTargetPrice] = useState("");
  // "20" is just a sensible starting value to type over — not a target the
  // sheet is measured against.
  const [targetMargin, setTargetMargin] = useState("20");
  const priceId = useId();
  const marginId = useId();

  const price = Number(targetPrice);
  const margin = Number(targetMargin);
  const valid = Number.isFinite(price) && price > 0 && Number.isFinite(margin);

  const budget = valid ? maxSupplierTotalForMargin(price, margin) : null;
  const headroom = budget === null ? null : round2(budget - expenseTotal);

  return (
    <div className="spot-bid">
      <h3>Can we do it at their price?</h3>
      <p className="section-description">
        For spot bids and "we need this for around R X" calls. Enter what the mine will pay
        (excluding VAT) and this works backwards to what you can afford to spend.
      </p>

      <div className="spot-bid-fields">
        <label className="field">
          <span>Their price (excl. VAT)</span>
          <input
            id={priceId}
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Margin to hold</span>
          <input
            id={marginId}
            type="number"
            step="1"
            max={99}
            value={targetMargin}
            onChange={(e) => setTargetMargin(e.target.value)}
          />
        </label>
      </div>

      {budget === null ? (
        <p className="field-hint">
          Enter their price to see your supplier budget.
        </p>
      ) : (
        <div className="spot-bid-result">
          <div className="financial-grid">
            <span>Most you can spend with suppliers</span>
            <strong>R {budget.toFixed(2)}</strong>
            <span>Currently costed on this sheet</span>
            <strong>R {expenseTotal.toFixed(2)}</strong>
            <span>{headroom! >= 0 ? "Room left" : "Over budget by"}</span>
            <strong className={headroom! < 0 ? "margin-flag" : ""}>
              R {Math.abs(headroom!).toFixed(2)}
            </strong>
          </div>
          <p className={headroom! < 0 ? "field-hint margin-flag" : "field-hint"}>
            {expenseTotal === 0
              ? `Add supplier costs above and this will tell you whether the job still clears ${margin}%.`
              : headroom! >= 0
                ? `Costed at R ${expenseTotal.toFixed(2)}, this job clears ${margin}% at their price.`
                : `At R ${expenseTotal.toFixed(2)} of cost you'd land below ${margin}%. Source cheaper, or quote higher than their number.`}
          </p>
        </div>
      )}
    </div>
  );
}
