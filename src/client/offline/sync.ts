import { api } from "@/client/api";
import { getLocalOrder, putLocalOrder } from "./db";
import { dequeue, listOutboxFifo, markAttempt } from "./outbox";

export type SyncListener = () => void;

const listeners = new Set<SyncListener>();
let syncing = false;

export function onSyncChange(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((l) => l());
}

/**
 * Replays the outbox FIFO (plan.md §8.3). Single-flight per tab; triggered by the `online`
 * event, app start and a manual "Sync now" — no timer, no visibilitychange, no cross-tab locks
 * (server idempotency makes a duplicate replay from a second tab harmless).
 */
export async function runSync(): Promise<void> {
  if (syncing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  syncing = true;
  try {
    const entries = await listOutboxFifo();
    for (const entry of entries) {
      const result =
        entry.intent === "save"
          ? await api.saveOrder(entry.orderId, entry.payload)
          : await api.putOrder(entry.orderId, entry.payload);

      if (result.ok) {
        await dequeue(entry.orderId);
        const order = "order" in result.data ? result.data.order : result.data;
        const priceChanges = "priceChanges" in result.data ? result.data.priceChanges : [];
        await putLocalOrder({
          id: entry.orderId,
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
        await dequeue(entry.orderId);
        const details = result.error.details as { order?: unknown } | undefined;
        const existing = await getLocalOrder(entry.orderId);
        await putLocalOrder({
          id: entry.orderId,
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
        // Keep the queue; stop this run so the UI can prompt "Sign in to sync".
        break;
      }

      if (result.status === 0 || result.status >= 500) {
        // Network or server error: keep the entry, bump attempts, stop this run (retried later).
        await markAttempt(entry.orderId);
        break;
      }

      // Any other 4xx: the server refused it. Remove from the outbox and surface the error on
      // the order — it is never silently dropped, and the order becomes editable again.
      await dequeue(entry.orderId);
      const existing = await getLocalOrder(entry.orderId);
      await putLocalOrder({
        id: entry.orderId,
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
