import type { CatalogDealer } from "@/contracts/api";

export function DealerPicker({
  dealers,
  value,
  onChange,
  disabled,
}: {
  dealers: CatalogDealer[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="dealer-picker" className="text-body text-text-secondary">
        Dealer
      </label>
      <select
        id="dealer-picker"
        className="focus-ring w-64 rounded-md border border-border-default bg-bg-surface px-2 py-1.5 text-body"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a dealer…</option>
        {dealers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}
