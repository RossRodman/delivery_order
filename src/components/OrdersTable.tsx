import { formatUsd } from "@/domain";
import type { OrderSummary } from "@/contracts/api";
import { OrderStatusChip } from "@/components/OrderStatusChip";

export type LocalTag = "queued" | "rejected" | "local";

const LOCAL_TAG_CONFIG: Record<LocalTag, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-sand-100 text-sand-900" },
  rejected: { label: "Rejected — not saved", className: "bg-danger-100 text-danger-900" },
  local: { label: "Local (offline)", className: "bg-blocked-100 text-blocked-900" },
};

/**
 * `localTags` (review M-3): orders that only exist in IndexedDB — a locally queued save, one the
 * server refused on sync, or a draft that has never reached the network — get an extra badge so
 * they are never findable only by knowing their URL.
 */
export function OrdersTable({
  orders,
  onRowClick,
  localTags = {},
}: {
  orders: OrderSummary[];
  onRowClick: (order: OrderSummary) => void;
  localTags?: Record<string, LocalTag>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-default bg-bg-surface">
      <table className="w-full min-w-[640px] text-body">
        <thead>
          <tr className="border-b border-border-default text-left text-small text-text-secondary">
            <th className="px-3 py-2">Dealer</th>
            <th className="px-3 py-2">Adviser</th>
            <th className="px-3 py-2">Total (USD)</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Updated</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              onClick={() => onRowClick(order)}
              className="cursor-pointer border-b border-border-default last:border-0 hover:bg-bg-canvas"
            >
              <td className="px-3 py-2">{order.dealer.name}</td>
              <td className="px-3 py-2">{order.createdBy.name}</td>
              <td className="px-3 py-2 tabular-nums">
                {order.status === "draft" ? "—" : formatUsd(order.totalUsdCents)}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <OrderStatusChip status={order.status} hasRejectedLines={order.hasRejectedLines} />
                  {localTags[order.id] && (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-small font-medium ${LOCAL_TAG_CONFIG[localTags[order.id]].className}`}
                    >
                      {LOCAL_TAG_CONFIG[localTags[order.id]].label}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-text-secondary">
                {new Date(order.updatedAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
