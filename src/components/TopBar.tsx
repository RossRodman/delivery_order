"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/client/api";
import type { UserView } from "@/contracts/api";
import { OnlineOfflineIndicator } from "@/components/OnlineOfflineIndicator";

export function TopBar({
  user,
  backHref,
  title,
}: {
  user?: UserView | null;
  backHref?: string;
  title?: string;
}) {
  const router = useRouter();

  return (
    <header className="flex items-center justify-between border-b border-border-default bg-bg-surface px-4 py-3">
      <div className="flex items-center gap-4">
        {backHref && (
          <Link href={backHref} className="focus-ring text-body text-brand-600 hover:underline">
            ← Back
          </Link>
        )}
        <span className="text-h2">{title ?? "Order Desk"}</span>
      </div>
      <div className="flex items-center gap-4">
        <OnlineOfflineIndicator />
        {user && (
          <nav className="flex items-center gap-3 text-body">
            <Link href="/orders" className="focus-ring hover:underline">
              Orders
            </Link>
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
                router.push("/login");
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
