import { api } from "@/client/api";
import { getCachedMe, getLocalOrder, putLocalOrder } from "./db";
import { dequeue, listOutboxFifo, markAttempt } from "./outbox";

export type SyncListener = () => void;

const listeners = new Set<SyncListener>();
let syncing = false;
let needsSignIn = false;

export function onSyncChange(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((l) => l());
}

/** True once a sync attempt has hit 401 (review m-5): the UI should prompt "Sign in to sync". */
export function getNeedsSignIn(): boolean {
  return needsSignIn;
}

/**
 * Replays the outbox FIFO (plan.md §8.3). Single-flight per tab; triggered by the `online`
 * event, app start and a manual "Sync now" — no timer, no visibilitychange, no cross-tab locks
 * (server idempotency makes a duplicate replay from a second tab harmless).
 *
 * Review M-1: an entry is only replayed while it belongs to the *currently signed-in* user
 * (resolved from the cached `me`, so this also works offline). Another user's queued entry is
 * left untouched in the outbox — never sent, never silently dropped — until that user signs back
 * in on this device.
 */
export async function runSync(): Promise<void> {
  if (syncing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  syncing = true;
  try {
    const me = await getCachedMe();
    const currentUserId = me?.id ?? null;
    const entries = await listOutboxFifo();
    for (const entry of entries) {
      if (!currentUserId || entry.userId !== currentUserId) {
        continue;
      }

      const result =
        entry.intent === "save"
          ? await api.saveOrder(entry.orderId, entry.payload)
          : await api.putOrder(entry.orderId, entry.payload);

      if (result.ok) {
        needsSignIn = false;
        await dequeue(entry.orderId);
        const order = "order" in result.data ? result.data.order : result.data;
        const priceChanges = "priceChanges" in result.data ? result.data.priceChanges : [];
        await putLocalOrder({
          id: entry.orderId,
          userId: entry.userId,
          input: entry.payload,
          server: order,
          syncState: "synced",
          lastError: null,
          priceChanges,
          updatedAt: new Date().toISOString(),
        });
        continue;
      }

      if (result.error.code === "ORDER_ALREADY_SAVED") {
        // Idempotent replay landed on an already-saved order with the same content elsewhere;
        // treat it as synced using the server's copy of record.
        needsSignIn = false;
        await dequeue(entry.orderId);
        const details = result.error.details as { order?: unknown } | undefined;
        const existing = await getLocalOrder(entry.orderId);
        await putLocalOrder({
          id: entry.orderId,
          userId: entry.userId,
          input: entry.payload,
          server: (details?.order as never) ?? existing?.server ?? null,
          syncState: "synced",
          lastError: null,
          priceChanges: existing?.priceChanges ?? [],
          updatedAt: new Date().toISOString(),
        });
        continue;
      }

      if (result.error.code === "UNAUTHENTICATED" || result.status === 401) {
        // Keep the queue; stop this run so the UI can prompt "Sign in to sync" (m-5).
        needsSignIn = true;
        break;
      }

      if (result.status === 0 || result.status >= 500) {
        // Network or server error: keep the entry, bump attempts, stop this run (retried later).
        await markAttempt(entry.orderId);
        break;
      }

      // Any other 4xx: the server refused it. Remove from the outbox and surface the error on
      // the order — it is never silently dropped, and the order becomes editable again.
      needsSignIn = false;
      await dequeue(entry.orderId);
      const existing = await getLocalOrder(entry.orderId);
      await putLocalOrder({
        id: entry.orderId,
        userId: entry.userId,
        input: entry.payload,
        server: existing?.server ?? null,
        syncState: "rejected",
        lastError: result.error,
        priceChanges: existing?.priceChanges ?? [],
        updatedAt: new Date().toISOString(),
      });
    }
  } finally {
    syncing = false;
    notify();
  }
}

export function isSyncing(): boolean {
  return syncing;
}
