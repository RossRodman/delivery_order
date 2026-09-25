import { formatUsd } from "@/domain";
import type { OrderSummary } from "@/contracts/api";
import { OrderStatusChip } from "@/components/OrderStatusChip";

export function OrdersTable({
  orders,
  onRowClick,
}: {
  orders: OrderSummary[];
  onRowClick: (order: OrderSummary) => void;
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
                <OrderStatusChip status={order.status} hasRejectedLines={order.hasRejectedLines} />
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
