"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/client/api";
import { useMe } from "@/client/hooks/useMe";
import type { OrderStatus, OrderSummary } from "@/contracts/api";
import { TopBar } from "@/components/TopBar";
import { OrdersTable, type LocalTag } from "@/components/OrdersTable";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/Skeleton";
import { loadCatalog } from "@/client/offline/catalog";
import { listLocalOrders, type LocalOrder } from "@/client/offline/db";
import { buildLocalSummary } from "@/client/offline/orders";
import { listOutboxFifo } from "@/client/offline/outbox";

/** "Queued" (outbox has a `save`) beats "Rejected" beats "Local" (never reached the network). */
async function tagLocalOrders(local: LocalOrder[], userId: string): Promise<Record<string, LocalTag>> {
  const outbox = await listOutboxFifo();
  const saveQueued = new Set(outbox.filter((e) => e.userId === userId && e.intent === "save").map((e) => e.orderId));
  const tags: Record<string, LocalTag> = {};
  for (const l of local) {
    if (saveQueued.has(l.id)) tags[l.id] = "queued";
    else if (l.syncState === "rejected") tags[l.id] = "rejected";
    else if (l.syncState !== "synced") tags[l.id] = "local";
  }
  return tags;
}

export default function OrdersPage() {
  const router = useRouter();
  const me = useMe();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [localTags, setLocalTags] = useState<Record<string, LocalTag>>({});
  const [offlineList, setOfflineList] = useState(false);
  const [counts, setCounts] = useState({ pendingApproval: 0 });
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const meId = me.status === "authenticated" ? me.user.id : null;

  useEffect(() => {
    if (me.status !== "authenticated") return;
    const meUser = me.user;
    let cancelled = false;

    async function load() {
      const serverResult = await api.listOrders(filter === "all" ? undefined : filter);
      if (cancelled) return;

      // Review M-3: local-only orders (queued, rejected on sync, or never yet reached the
      // network) are merged in so they're never findable only by URL — and, offline, the list
      // renders entirely from IndexedDB instead of an endless skeleton.
      const local = filter === "all" ? await listLocalOrders(meUser.id) : [];
      const catalog = local.length > 0 ? await loadCatalog() : null;

      if (serverResult.ok) {
        setOfflineList(false);
        setCounts(serverResult.data.counts);
        const merged = new Map(serverResult.data.orders.map((o) => [o.id, o] as const));
        const tags = await tagLocalOrders(local, meUser.id);
        if (catalog) {
          for (const l of local) {
            if (l.syncState === "synced" && merged.has(l.id)) continue; // already represented cleanly
            merged.set(l.id, buildLocalSummary(l, catalog, meUser));
          }
        }
        if (cancelled) return;
        setOrders(Array.from(merged.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        setLocalTags(tags);
        return;
      }

      // Offline (or any other failure): render entirely from the local cache, scoped to this
      // user, rather than a skeleton that never resolves.
      setOfflineList(true);
      setCounts({ pendingApproval: 0 });
      const allLocal = await listLocalOrders(meUser.id);
      const cat = catalog ?? (await loadCatalog());
      const tags = await tagLocalOrders(allLocal, meUser.id);
      if (cancelled) return;
      if (!cat) {
        setOrders([]);
        setLocalTags({});
        return;
      }
      const summaries = allLocal.map((l) => buildLocalSummary(l, cat, meUser));
      setOrders(summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setLocalTags(tags);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.status, meId, filter]);

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
      {offlineList && (
        <div className="mx-4 rounded-md border border-offline-500 bg-sand-100 px-4 py-2 text-small text-sand-900">
          Showing cached orders. Some may be out of date.
        </div>
      )}
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
          <OrdersTable orders={orders} onRowClick={openOrder} localTags={localTags} />
        )}
      </div>
    </div>
  );
}
