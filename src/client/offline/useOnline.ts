"use client";

import { useEffect, useState } from "react";
import { outboxCount } from "./outbox";
import { onSyncChange, runSync } from "./sync";

export interface OnlineState {
  isOnline: boolean;
  pendingSyncCount: number;
  syncNow: () => void;
}

/**
 * Tracks online/offline + pending-sync count and drives the sync engine's triggers
 * (plan.md §8.3): app start, the `online` event, and a manual call.
 */
export function useOnline(): OnlineState {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function refreshCount() {
      const count = await outboxCount();
      if (!cancelled) setPendingSyncCount(count);
    }

    function handleOnline() {
      setIsOnline(true);
      runSync().then(refreshCount);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const unsubscribe = onSyncChange(refreshCount);

    // App start trigger.
    refreshCount();
    if (navigator.onLine) runSync().then(refreshCount);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribe();
    };
  }, []);

  return {
    isOnline,
    pendingSyncCount,
    syncNow: () => {
      runSync();
    },
  };
}
