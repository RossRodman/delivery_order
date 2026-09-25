"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRate, formatSdg, formatUsd } from "@/domain";
import { api } from "@/client/api";
import { useMe } from "@/client/hooks/useMe";
import type { OrderView } from "@/contracts/api";
import { TopBar } from "@/components/TopBar";
import { Skeleton } from "@/components/Skeleton";
import { ApprovalLineCard } from "@/components/ApprovalLineCard";
import { DiscountStateBadge } from "@/components/DiscountStateBadge";
import { useToast } from "@/components/Toast";

export default function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const me = useMe();
  const { show } = useToast();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);

  async function reload() {
    const result = await api.getOrder(id);
    if (result.ok) setOrder(result.data);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    api.getOrder(id).then((result) => {
      if (cancelled) return;
      if (result.ok) setOrder(result.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (me.status === "loading" || loading) {
    return (
      <div className="p-6">
        <Skeleton rows={4} />
      </div>
    );
  }
  if (me.status === "unauthenticated") {
    router.push("/login");
    return null;
  }
  if (me.status === "authenticated" && me.user.role !== "owner") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-body">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="p-6">
        <p className="text-body">Order not found.</p>
      </div>
    );
  }

  const pendingLines = order.lines.filter((l) => l.approval.status === "pending");
  const otherLines = order.lines.filter((l) => l.approval.status !== "pending");
  const allApprovedTotal = order.lines.reduce((sum, l) => sum + l.lineTotalCents, 0);

  async function decide(lineId: string, decision: "approve" | "reject") {
    const line = order!.lines.find((l) => l.id === lineId);
    if (!line) return;
    setBusyLineId(lineId);
    const result = await api.decideLine(order!.id, lineId, {
      decision,
      expectedTerms: {
        productId: line.product.id,
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        discountCents: line.discountCents,
      },
    });
    setBusyLineId(null);
    if (result.ok) {
      setOrder(result.data.order);
    } else if (result.error.code === "LINE_TERMS_CHANGED") {
      show("This line changed since you opened it.", "error");
      reload();
    } else {
      show(result.error.message, "error");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <TopBar user={me.status === "authenticated" ? me.user : null} backHref="/orders" title="Awaiting approval" />
      <p className="text-body text-text-secondary">
        Order · {order.dealer.name} · by {order.createdBy.name}
      </p>

      {order.status === "draft" && pendingLines.length === 0 ? (
        <div className="rounded-lg border border-border-default bg-bg-surface p-6 text-center">
          <p className="text-body">All lines decided — returned to {order.createdBy.name}.</p>
          <button
            type="button"
            onClick={() => router.push("/orders")}
            className="focus-ring mt-2 text-body text-brand-600 hover:underline"
          >
            ← Back to Awaiting approval
          </button>
        </div>
      ) : pendingLines.length === 0 ? (
        <p className="text-body text-text-secondary">Nothing pending on this order.</p>
      ) : (
        <>
          <h2 className="text-h2">Lines requiring approval</h2>
          <div className="flex flex-col gap-2">
            {pendingLines.map((line) => (
              <ApprovalLineCard
                key={line.id}
                line={line}
                busy={busyLineId === line.id}
                onApprove={() => decide(line.id, "approve")}
                onReject={() => decide(line.id, "reject")}
              />
            ))}
          </div>
        </>
      )}

      {otherLines.length > 0 && (
        <>
          <h2 className="text-h2">Other lines (for context, read-only)</h2>
          <div className="flex flex-col gap-1">
            {otherLines.map((line) => (
              <div key={line.id} className="flex items-center gap-2 text-body">
                <span>
                  {line.product.name} ×{line.qty} · {formatUsd(line.lineTotalCents)}
                </span>
                <DiscountStateBadge state={line.approval.status === "rejected" ? "rejected" : line.state} />
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-body text-text-secondary">
        Order total if all approved: {formatUsd(allApprovedTotal)} = {formatSdg(order.totals.sdg)} (rate{" "}
        {formatRate(order.rate)})
      </p>
    </div>
  );
}
