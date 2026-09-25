import { Lock } from "lucide-react";

export function LockedFieldTooltip({ label }: { label: string }) {
  return (
    <span
      title="Snapshot at save time — not affected by later changes."
      className="inline-flex items-center gap-1 text-text-secondary"
    >
      <Lock size={12} aria-hidden="true" />
      <span className="sr-only">{label} is locked: </span>
    </span>
  );
}
