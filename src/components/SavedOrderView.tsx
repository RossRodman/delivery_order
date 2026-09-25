import { formatPercent, formatRate, formatSdg, formatUsd } from "@/domain";
import type { OrderView } from "@/contracts/api";
import { DiscountStateBadge } from "@/components/DiscountStateBadge";
import { LockedFieldTooltip } from "@/components/LockedFieldTooltip";

/** Read-only, immutable record of a saved order (design.md §3.6, R7/AC4). */
export function SavedOrderView({ order, queued }: { order: OrderView; queued?: boolean }) {
  const savedDate = order.savedAt ? new Date(order.savedAt).toLocaleDateString() : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-display">
          Order #{order.number} ·{" "}
          {queued ? <span className="text-sand-900">Queued</span> : savedDate ? `Saved ${savedDate}` : "Saved"}
        </h1>
      </div>
      <div className="flex items-center justify-between text-body">
        <span>Dealer: {order.dealer.name}</span>
        <span className="flex items-center gap-1">
          <LockedFieldTooltip label="Rate" />
          Rate: {formatRate(order.rate)} <span className="text-small text-text-secondary">(snapshot — fixed)</span>
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-default bg-bg-surface">
        <table className="w-full min-w-[640px] text-body">
          <thead>
            <tr className="border-b border-border-default text-left text-small text-text-secondary">
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Unit price</th>
              <th className="px-3 py-2">Discount</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id} className="border-b border-border-default last:border-0">
                <td className="px-3 py-2">
                  {line.product.name} ×{line.qty}
                </td>
                <td className="px-3 py-2 tabular-nums text-text-secondary">
                  <LockedFieldTooltip label="Unit price" />
                  {formatUsd(line.unitPriceCents)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatUsd(line.discountCents)} ({formatPercent(line.discountBasisPoints)})
                </td>
                <td className="px-3 py-2">
                  <DiscountStateBadge state={line.state} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-mono-num font-semibold">
                  {formatUsd(line.lineTotalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col items-end gap-1 text-body">
        <div className="flex w-64 justify-between">
          <span className="text-text-secondary">Order total (USD)</span>
          <span className="tabular-nums text-mono-num">{formatUsd(order.totals.usdCents)}</span>
        </div>
        <div className="flex w-64 justify-between">
          <span className="text-text-secondary">Order total (SDG)</span>
          <span className="tabular-nums text-mono-num" data-testid="totals-sdg">
            {formatSdg(order.totals.sdg)}
          </span>
        </div>
      </div>
    </div>
  );
}
