"use client";

import Link from "next/link";
import { api } from "@/client/api";
import type { UserView } from "@/contracts/api";
import { OnlineOfflineIndicator } from "@/components/OnlineOfflineIndicator";
import { useOnline } from "@/client/offline/useOnline";

export function TopBar({
  user,
  backHref,
  title,
}: {
  user?: UserView | null;
  backHref?: string;
  title?: string;
}) {
  const { isOnline, pendingSyncCount, syncNow } = useOnline();

  return (
    <header className="flex items-center justify-between border-b border-border-default bg-bg-surface px-4 py-3">
      <div className="flex items-center gap-4">
        {backHref && (
          // Plain <a>, not next/link: a real browser navigation so the service worker's
          // network-first handler (mode: "navigate") can cache/serve /orders and /order for
          // offline use (plan.md §7/§8.1) — a soft client navigation would bypass it.
          <a href={backHref} className="focus-ring text-body text-brand-600 hover:underline">
            ← Back
          </a>
        )}
        <span className="text-h2">{title ?? "Order Desk"}</span>
      </div>
      <div className="flex items-center gap-4">
        <OnlineOfflineIndicator isOnline={isOnline} pendingSyncCount={pendingSyncCount} />
        {pendingSyncCount > 0 && isOnline && (
          <button type="button" onClick={syncNow} className="focus-ring text-small text-brand-600 hover:underline">
            Sync now
          </button>
        )}
        {user && (
          <nav className="flex items-center gap-3 text-body">
            <a href="/orders" className="focus-ring hover:underline">
              Orders
            </a>
            {user.role === "owner" && (
              <Link href="/settings" className="focus-ring hover:underline">
                Settings
              </Link>
            )}
            <span className="text-text-secondary">{user.name}</span>
            <button
              type="button"
              className="focus-ring text-brand-600 hover:underline"
              onClick={async () => {
                await api.logout();
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.href = "/login";
              }}
            >
              Sign out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
