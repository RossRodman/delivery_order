"use client";

import { CloudOff, Wifi, WifiOff } from "lucide-react";

/**
 * Stub for F1 (design.md §3.2 top bar): shows the browser's online/offline flag.
 * The real pending-sync count is wired in by F7's outbox; until then it's always 0.
 */
export function OnlineOfflineIndicator({
  isOnline = true,
  pendingSyncCount = 0,
}: {
  isOnline?: boolean;
  pendingSyncCount?: number;
}) {
  return (
    <div className="flex items-center gap-2 text-small text-text-secondary">
      {isOnline ? (
        <span className="inline-flex items-center gap-1 text-approved-700">
          <Wifi size={14} aria-hidden="true" /> Online
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-offline-500">
          <WifiOff size={14} aria-hidden="true" /> Offline
        </span>
      )}
      {pendingSyncCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-sand-100 px-2 py-0.5 text-sand-900">
          <CloudOff size={12} aria-hidden="true" /> {pendingSyncCount} pending sync
        </span>
      )}
    </div>
  );
}
