"use client";

import { useEffect, useState } from "react";
import { getCachedMe } from "./db";
import { outboxCount } from "./outbox";
import { getNeedsSignIn, onSyncChange, runSync } from "./sync";

export interface OnlineState {
  isOnline: boolean;
  pendingSyncCount: number;
  needsSignIn: boolean;
  syncNow: () => void;
}

/**
 * Tracks online/offline + pending-sync count and drives the sync engine's triggers
 * (plan.md §8.3): app start, the `online` event, and a manual call. `pendingSyncCount` and
 * `needsSignIn` only ever reflect the currently signed-in user (review M-1): another user's
 * queued entries exist in the outbox but are invisible here and never synced under this session.
 */
export function useOnline(): OnlineState {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [needsSignIn, setNeedsSignIn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refreshCount() {
      const me = await getCachedMe();
      const count = await outboxCount(me?.id);
      if (cancelled) return;
      setPendingSyncCount(count);
      setNeedsSignIn(getNeedsSignIn());
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
    needsSignIn,
    syncNow: () => {
      runSync();
    },
  };
}
