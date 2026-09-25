import type { OrderStatus } from "@/contracts/api";

const STATUS_CONFIG: Record<OrderStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-blocked-100 text-blocked-900" },
  pending_approval: { label: "Pending approval", className: "bg-sand-100 text-sand-900" },
  saved: { label: "Saved", className: "bg-approved-100 text-approved-900" },
};

export function OrderStatusChip({
  status,
  hasRejectedLines,
}: {
  status: OrderStatus;
  hasRejectedLines?: boolean;
}) {
  const config = hasRejectedLines
    ? { label: "Rejected line", className: "bg-danger-100 text-danger-900" }
    : STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-small font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
