"use client";

import Link from "next/link";
import { api } from "@/client/api";
import type { UserView } from "@/contracts/api";
import { OnlineOfflineIndicator } from "@/components/OnlineOfflineIndicator";
import { useOnline } from "@/client/offline/useOnline";
import { clearAll, clearServiceWorkerCaches } from "@/client/offline/db";
import { outboxCount } from "@/client/offline/outbox";

export function TopBar({
  user,
  backHref,
  title,
}: {
  user?: UserView | null;
  backHref?: string;
  title?: string;
}) {
  const { isOnline, pendingSyncCount, needsSignIn, syncNow } = useOnline();

  async function handleSignOut() {
    // Review M-1: sign-out must not leave this user's cached orders, outbox or identity behind
    // for whoever signs in next on this device.
    if (user) {
      const mine = await outboxCount(user.id);
      if (mine > 0) {
        const proceed = window.confirm(
          `You have ${mine} order(s) waiting to sync. They will not upload until you sign back in as ${user.name}. Sign out anyway?`,
        );
        if (!proceed) return;
      }
    }
    await api.logout();
    await clearAll();
    await clearServiceWorkerCaches();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

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
        {needsSignIn && (
          <a href="/login" className="focus-ring text-small text-danger-900 hover:underline">
            Sign in to sync
          </a>
        )}
        {!needsSignIn && pendingSyncCount > 0 && isOnline && (
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
            <button type="button" className="focus-ring text-brand-600 hover:underline" onClick={handleSignOut}>
              Sign out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
