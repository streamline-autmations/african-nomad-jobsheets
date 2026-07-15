import type { Company } from "../types";

interface CompanySelectProps {
  companies: Company[];
  value: string;
  onChange: (companyId: string) => void;
}

export function CompanySelect({ companies, value, onChange }: CompanySelectProps) {
  return (
    <label className="field">
      <span>Company</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="" disabled>
          Select a company…
        </option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
    </label>
  );
}
