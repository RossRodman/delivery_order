import type { Role } from "@/contracts/api";

export function RoleLoginCard({
  name,
  role,
  onSelect,
  disabled,
}: {
  name: string;
  role: Role;
  onSelect: (role: Role) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(role)}
      disabled={disabled}
      className="focus-ring flex min-w-[160px] flex-col items-center gap-1 rounded-lg border border-border-default bg-bg-surface p-6 text-center shadow-sm transition hover:border-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="text-h2 capitalize">{role}</span>
      <span className="text-body text-text-secondary">{name}</span>
    </button>
  );
}
