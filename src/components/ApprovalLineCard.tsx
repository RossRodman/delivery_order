"use client";

import { useState } from "react";
import { formatPercent, formatUsd } from "@/domain";
import type { LineView } from "@/contracts/api";
import { DiscountStateBadge } from "@/components/DiscountStateBadge";

export function ApprovalLineCard({
  line,
  onApprove,
  onReject,
  busy,
}: {
  line: LineView;
  onApprove: () => void;
  onReject: () => void;
  busy?: boolean;
}) {
  const [confirmingReject, setConfirmingReject] = useState(false);

  return (
    <div className="flex items-center justify-between rounded-lg border border-border-default bg-bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="text-body">
          {line.product.name} ×{line.qty} · {formatUsd(line.unitPriceCents)} unit · Discount{" "}
          {formatUsd(line.discountCents)} ({formatPercent(line.discountBasisPoints)})
        </span>
        <DiscountStateBadge state="blocked" />
      </div>
      {confirmingReject ? (
        <div className="flex items-center gap-2">
          <span className="text-small text-text-secondary">
            Reject this line? The adviser will need to change it.
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="focus-ring rounded-md bg-danger-900 px-3 py-1.5 text-body text-white"
          >
            Confirm reject
          </button>
          <button
            type="button"
            onClick={() => setConfirmingReject(false)}
            className="focus-ring text-body text-text-secondary"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmingReject(true)}
            className="focus-ring rounded-md border border-danger-500 px-3 py-1.5 text-body text-danger-900"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="focus-ring rounded-md bg-brand-600 px-3 py-1.5 text-body text-white"
          >
            Approve
          </button>
        </div>
      )}
    </div>
  );
}
