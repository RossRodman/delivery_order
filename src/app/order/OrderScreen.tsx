"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMe } from "@/client/hooks/useMe";
import { useOrder } from "@/client/hooks/useOrder";
import { TopBar } from "@/components/TopBar";
import { DealerPicker } from "@/components/DealerPicker";
import { RateInput } from "@/components/RateInput";
import { OrderLinesTable } from "@/components/OrderLinesTable";
import { ProductPickerModal } from "@/components/ProductPickerModal";
import { TotalsPanel } from "@/components/TotalsPanel";
import { ActionBar } from "@/components/ActionBar";
import { ErrorBanner } from "@/components/ErrorBanner";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { OrderStatusChip } from "@/components/OrderStatusChip";
import { SavedOrderView } from "@/components/SavedOrderView";
import { ERROR_MESSAGES } from "@/contracts/errors";

export function OrderScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const me = useMe();
  const [orderId] = useState(() => searchParams.get("id") ?? crypto.randomUUID());
  const [pickerOpen, setPickerOpen] = useState(false);

  const meId = me.status === "authenticated" ? me.user.id : null;
  const order = useOrder(orderId, meId);

  useMemo(() => {
    if (!searchParams.get("id") && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("id", orderId);
      window.history.replaceState(null, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (me.status === "loading" || order.loading) {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar user={me.status === "authenticated" ? me.user : null} backHref="/orders" title="Order" />
        <div className="p-6">
          <Skeleton rows={5} />
        </div>
      </div>
    );
  }

  if (me.status === "unauthenticated") {
    router.push("/login");
    return null;
  }

  // Owner opening a pending order goes to the dedicated approval view.
  if (order.server?.status === "pending_approval" && me.user.role === "owner" && !order.isCreator) {
    router.push(`/approvals/${orderId}`);
    return null;
  }

  if (order.server?.status === "saved") {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar user={me.user} backHref="/orders" title="Order" />
        <SavedOrderView order={order.server} />
      </div>
    );
  }

  // A locally queued save (offline) renders read-only until it syncs or is rejected (m-3).
  if (order.queued && order.localOrderView) {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar user={me.user} backHref="/orders" title="Order" />
        <SavedOrderView order={order.localOrderView} queued />
      </div>
    );
  }

  const readOnly = !order.canEdit || order.server?.status === "pending_approval";
  const computed = order.computed;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <TopBar user={me.user} backHref="/orders" title="Order" />
      <div className="flex items-center gap-3">
        <h1 className="text-display">Order #{order.server?.number ?? "—"}</h1>
        <OrderStatusChip status={order.server?.status ?? "draft"} />
      </div>

      {order.error && (
        <ErrorBanner
          message={`Couldn't save — ${
            order.error.code === "NETWORK" ? order.error.message : ERROR_MESSAGES[order.error.code]
          }`}
        />
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <DealerPicker
          dealers={order.catalog?.dealers ?? []}
          value={order.dealerId}
          onChange={order.setDealerId}
          disabled={readOnly}
        />
        <RateInput
          value={order.rate}
          defaultValue={order.catalog?.globalRate}
          onChange={order.setRate}
          disabled={readOnly}
        />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-h2">Order lines</h2>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={!order.dealerId}
            className="focus-ring rounded-md border border-brand-600 px-3 py-1.5 text-body text-brand-600 disabled:opacity-50"
          >
            + Add product
          </button>
        )}
      </div>

      {order.lines.length === 0 ? (
        <EmptyState
          message="No products added yet."
          action={
            !readOnly && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={!order.dealerId}
                className="focus-ring rounded-md bg-brand-600 px-3 py-1.5 text-body text-white disabled:opacity-50"
              >
                + Add product
              </button>
            )
          }
        />
      ) : (
        computed && (
          <OrderLinesTable
            lines={order.lines}
            computedLines={computed.lines}
            products={order.catalog?.products ?? []}
            onQtyChange={order.setQty}
            onDiscountChange={order.setDiscountCents}
            onRemove={order.removeLine}
            readOnly={readOnly}
            approvalMeta={Object.fromEntries(
              (order.server?.lines ?? []).map((l) => [
                l.id,
                { decidedByName: l.approval.decidedBy?.name, decidedAt: l.approval.decidedAt },
              ]),
            )}
          />
        )
      )}

      {computed && computed.lines.length > 0 && (
        <TotalsPanel
          subtotalUsdCents={computed.totalUsdCents}
          totalUsdCents={computed.totalUsdCents}
          totalSdg={computed.totalSdg}
          rate={order.rate}
        />
      )}

      {!order.isOnline && (
        <div className="rounded-md border border-offline-500 bg-sand-100 px-4 py-3 text-body text-sand-900">
          You&apos;re offline. Changes are saved on this device and will sync when you&apos;re back online.
        </div>
      )}

      {!readOnly && (
        <ActionBar
          canSave={Boolean(computed?.canSave)}
          canRequestApproval={Boolean(order.isOnline && computed && computed.blockingLineIds.length > 0)}
          isPendingApproval={order.server?.status === "pending_approval"}
          isOffline={!order.isOnline}
          saving={order.saving}
          onSave={order.save}
          onRequestApproval={order.requestApproval}
          onWithdraw={order.isOnline ? order.withdraw : undefined}
        />
      )}

      {pickerOpen && (
        <ProductPickerModal
          products={order.catalog?.products ?? []}
          onAdd={order.addLine}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
