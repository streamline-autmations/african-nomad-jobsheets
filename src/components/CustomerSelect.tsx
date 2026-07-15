import type { Customer } from "../types";

interface CustomerSelectProps {
  customers: Customer[];
  customerId: string | null;
  customerNameRaw: string;
  isNewCustomer: boolean;
  onSelectExisting: (customerId: string, name: string) => void;
  onToggleNew: (isNew: boolean) => void;
  onNewNameChange: (name: string) => void;
}

export function CustomerSelect({
  customers,
  customerId,
  customerNameRaw,
  isNewCustomer,
  onSelectExisting,
  onToggleNew,
  onNewNameChange,
}: CustomerSelectProps) {
  return (
    <div className="field">
      <span>Customer</span>

      {!isNewCustomer && (
        <select
          value={customerId ?? ""}
          onChange={(e) => {
            const selected = customers.find((c) => c.id === e.target.value);
            if (selected) onSelectExisting(selected.id, selected.name);
          }}
          required
        >
          <option value="" disabled>
            Select a customer…
          </option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      )}

      {isNewCustomer && (
        <input
          type="text"
          placeholder="Type the new customer's name"
          value={customerNameRaw}
          onChange={(e) => onNewNameChange(e.target.value)}
          required
        />
      )}

      <label className="checkbox-inline">
        <input
          type="checkbox"
          checked={isNewCustomer}
          onChange={(e) => onToggleNew(e.target.checked)}
        />
        This customer doesn&apos;t exist yet
      </label>

      {isNewCustomer && (
        <p className="field-hint">
          A new-customer request will be staged on this job sheet and only
          sent to QuickBooks once you approve it.
        </p>
      )}
    </div>
  );
}
