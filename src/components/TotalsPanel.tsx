import { formatSdg, formatUsd } from "@/domain";

export function TotalsPanel({
  subtotalUsdCents,
  totalUsdCents,
  totalSdg,
  rate,
}: {
  subtotalUsdCents: number;
  totalUsdCents: number;
  totalSdg: number;
  rate: number;
}) {
  return (
    <div className="flex flex-col items-end gap-1 text-body">
      <div className="flex w-64 justify-between">
        <span className="text-text-secondary">Subtotal (USD)</span>
        <span className="tabular-nums text-mono-num">{formatUsd(subtotalUsdCents)}</span>
      </div>
      <div className="flex w-64 justify-between">
        <span className="text-text-secondary">Order total (USD)</span>
        <span className="tabular-nums text-mono-num">{formatUsd(totalUsdCents)}</span>
      </div>
      <div className="flex w-64 justify-between">
        <span className="text-text-secondary">Order total (SDG)</span>
        <span className="tabular-nums text-mono-num" data-testid="totals-sdg">
          {formatSdg(totalSdg)}
        </span>
      </div>
      <p className="text-small text-text-secondary">at {rate.toLocaleString("en-US")} SDG/USD</p>
    </div>
  );
}
