"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/client/api";
import { useMe } from "@/client/hooks/useMe";
import type { OrderStatus, OrderSummary } from "@/contracts/api";
import { TopBar } from "@/components/TopBar";
import { OrdersTable } from "@/components/OrdersTable";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";

export default function OrdersPage() {
  const router = useRouter();
  const me = useMe();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [counts, setCounts] = useState({ pendingApproval: 0 });
  const [filter, setFilter] = useState<OrderStatus | "all">("all");

  useEffect(() => {
    if (me.status !== "authenticated") return;
    let cancelled = false;
    api.listOrders(filter === "all" ? undefined : filter).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setOrders(result.data.orders);
        setCounts(result.data.counts);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [me.status, filter]);

  if (me.status === "loading") {
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

  function openOrder(order: OrderSummary) {
    // A real navigation (not router.push): /order must be fetched as a document at least once
    // online so the service worker's network-first handler can cache it for offline use.
    if (order.status === "pending_approval" && me.status === "authenticated" && me.user.role === "owner") {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/approvals/${order.id}`;
    } else {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/order?id=${order.id}`;
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <TopBar user={me.user} title="Orders" />
      <div className="flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`focus-ring rounded-md px-3 py-1.5 text-body ${
              filter === "all" ? "bg-brand-50 text-brand-700" : "text-text-secondary"
            }`}
          >
            All
          </button>
          {me.user.role === "owner" && (
            <button
              type="button"
              onClick={() => setFilter("pending_approval")}
              className={`focus-ring rounded-md px-3 py-1.5 text-body ${
                filter === "pending_approval" ? "bg-brand-50 text-brand-700" : "text-text-secondary"
              }`}
            >
              Awaiting approval ({counts.pendingApproval})
            </button>
          )}
        </div>
        <a
          href={`/order?id=${crypto.randomUUID()}`}
          className="focus-ring rounded-md bg-brand-600 px-3 py-1.5 text-body text-white"
        >
          + New order
        </a>
      </div>
      <div className="px-4 pb-4">
        {orders === null ? (
          <Skeleton rows={4} />
        ) : orders.length === 0 ? (
          <EmptyState
            message="No orders yet."
            action={
              <a
                href={`/order?id=${crypto.randomUUID()}`}
                className="focus-ring rounded-md bg-brand-600 px-3 py-1.5 text-body text-white"
              >
                + New order
              </a>
            }
          />
        ) : (
          <OrdersTable orders={orders} onRowClick={openOrder} />
        )}
      </div>
    </div>
  );
}
