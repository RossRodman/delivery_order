"use client";

import { Fragment, useState } from "react";
import { Trash2 } from "lucide-react";
import { formatPercent, formatUsd, parseUsdToCents } from "@/domain";
import type { ComputedLine } from "@/domain/order";
import type { CatalogProduct } from "@/contracts/api";
import { DiscountStateBadge } from "@/components/DiscountStateBadge";
import type { EditableLine } from "@/client/hooks/useOrder";

export interface ApprovalMeta {
  decidedByName?: string;
  decidedAt?: string | null;
}

function DiscountCell({
  cents,
  lineValueCents,
  onChange,
  disabled,
}: {
  cents: number;
  lineValueCents: number;
  onChange: (cents: number) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(formatUsd(cents).replace("$", ""));
  const [error, setError] = useState<string | null>(null);
  // Re-derive the displayed text when the value changes for a reason other than our own edit
  // (e.g. server data reload) — computed during render, not in an effect.
  const [syncedCents, setSyncedCents] = useState(cents);
  if (cents !== syncedCents) {
    setSyncedCents(cents);
    setText(formatUsd(cents).replace("$", ""));
  }

  function commit() {
    const parsed = parseUsdToCents(text);
    if (parsed === null) {
      setError("Enter a dollar amount with up to 2 decimals.");
      return;
    }
    setError(null);
    if (parsed < 0) {
      onChange(0);
      setText("0");
      return;
    }
    if (parsed > lineValueCents) {
      onChange(lineValueCents);
      setText(formatUsd(lineValueCents).replace("$", ""));
      setError(`Discount can't exceed the line value (${formatUsd(lineValueCents)}) — reset to ${formatUsd(lineValueCents)}.`);
      return;
    }
    onChange(parsed);
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        aria-label="Discount $"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        className="focus-ring w-24 rounded-md border border-border-default px-2 py-1 text-mono-num tabular-nums"
      />
      {error && (
        <p role="alert" className="text-small text-danger-900">
          {error}
        </p>
      )}
    </div>
  );
}

export function OrderLinesTable({
  lines,
  computedLines,
  products,
  onQtyChange,
  onDiscountChange,
  onRemove,
  readOnly,
  approvalMeta = {},
}: {
  lines: EditableLine[];
  computedLines: ComputedLine[];
  products: CatalogProduct[];
  onQtyChange?: (id: string, qty: number) => void;
  onDiscountChange?: (id: string, cents: number) => void;
  onRemove?: (id: string) => void;
  readOnly?: boolean;
  approvalMeta?: Record<string, ApprovalMeta>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-default bg-bg-surface">
      <table className="w-full min-w-[720px] text-body">
        <thead>
          <tr className="border-b border-border-default text-left text-small text-text-secondary">
            <th className="px-3 py-2">Product</th>
            <th className="px-3 py-2">Qty</th>
            <th className="px-3 py-2">Unit price</th>
            <th className="px-3 py-2">Discount $</th>
            <th className="px-3 py-2">Disc %</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2 text-right">Total</th>
            {!readOnly && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const product = products.find((p) => p.id === line.productId);
            const computed = computedLines.find((c) => c.id === line.id);
            if (!product || !computed) return null;
            const isBlocked = computed.state === "blocked";
            const meta = approvalMeta[line.id];
            return (
              <Fragment key={line.id}>
                <tr
                  data-line-id={line.id}
                  className={`border-b border-border-default last:border-0 ${
                    isBlocked ? "border-l-2 border-l-danger-500 border-dashed" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    {product.name} ×{line.qty}
                  </td>
                  <td className="px-3 py-2">
                    {readOnly ? (
                      line.qty
                    ) : (
                      <input
                        type="number"
                        min={1}
                        aria-label="Qty"
                        value={line.qty}
                        onChange={(e) => onQtyChange?.(line.id, Math.max(1, Number(e.target.value) || 1))}
                        className="focus-ring w-16 rounded-md border border-border-default px-2 py-1 text-mono-num tabular-nums"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-text-secondary">{formatUsd(product.unitPriceCents)}</td>
                  <td className="px-3 py-2">
                    {readOnly ? (
                      <span className="tabular-nums">{formatUsd(line.discountCents)}</span>
                    ) : (
                      <DiscountCell
                        cents={line.discountCents}
                        lineValueCents={computed.lineValueCents}
                        onChange={(cents) => onDiscountChange?.(line.id, cents)}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatPercent(computed.discountBasisPoints)}</td>
                  <td className="px-3 py-2">
                    <DiscountStateBadge state={computed.state} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-mono-num font-semibold">
                    {formatUsd(computed.lineTotalCents)}
                  </td>
                  {!readOnly && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-label={`Remove ${product.name}`}
                        onClick={() => onRemove?.(line.id)}
                        className="focus-ring text-text-secondary hover:text-danger-900"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  )}
                </tr>
                {computed.state === "blocked" && (
                  <tr>
                    <td colSpan={8} className="px-3 pb-2 text-small text-danger-900">
                      Blocked — needs owner approval before this order can be saved.
                    </td>
                  </tr>
                )}
                {computed.state === "approved" && (
                  <tr>
                    <td colSpan={8} className="px-3 pb-2 text-small text-approved-900">
                      Approved{meta?.decidedByName ? ` by ${meta.decidedByName}` : ""}
                      {meta?.decidedAt ? ` on ${new Date(meta.decidedAt).toLocaleDateString()}` : ""}. Changing qty,
                      discount, or a price change by the owner voids this approval.
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
