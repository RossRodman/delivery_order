import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ApiError } from "@/client/api";
import type { Catalog, OrderInput, OrderView, PriceChange, UserView } from "@/contracts/api";

export type SyncState = "local" | "queued" | "syncing" | "synced" | "rejected";

export interface LocalOrder {
  id: string;
  /** The user this local copy belongs to (review M-1) — never shown/replayed for another user. */
  userId: string;
  input: OrderInput;
  server: OrderView | null;
  syncState: SyncState;
  lastError: ApiError | null;
  priceChanges: PriceChange[];
  updatedAt: string;
}

export type OutboxIntent = "draft" | "save";

export interface OutboxEntry {
  orderId: string;
  /** The user who queued this entry (review M-1) — the sync engine only replays a matching user. */
  userId: string;
  intent: OutboxIntent;
  payload: OrderInput;
  enqueuedAt: string;
  attempts: number;
  nextAttemptAt: string;
}

interface OrderScreenDB extends DBSchema {
  meta: {
    key: string;
    value: unknown;
  };
  orders: {
    key: string;
    value: LocalOrder;
  };
  outbox: {
    key: string;
    value: OutboxEntry;
  };
}

const DB_NAME = "order-screen";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OrderScreenDB>> | null = null;

/** Opens (and lazily migrates) the shared IndexedDB database (plan.md §8.2). */
export function getDb(): Promise<IDBPDatabase<OrderScreenDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OrderScreenDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("orders")) db.createObjectStore("orders", { keyPath: "id" });
        if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "orderId" });
      },
    });
  }
  return dbPromise;
}

// ---------- meta ----------

export async function getMeta<T>(key: "me" | "catalog" | "lastSyncAt"): Promise<T | undefined> {
  const db = await getDb();
  return db.get("meta", key) as Promise<T | undefined>;
}

export async function setMeta(key: "me" | "catalog" | "lastSyncAt", value: unknown): Promise<void> {
  const db = await getDb();
  await db.put("meta", value, key);
}

export const getCachedMe = () => getMeta<UserView>("me");
export const setCachedMe = (user: UserView) => setMeta("me", user);
export const getCachedCatalog = () => getMeta<Catalog>("catalog");
export const setCachedCatalog = (catalog: Catalog) => setMeta("catalog", catalog);

// ---------- orders ----------

export async function getLocalOrder(id: string): Promise<LocalOrder | undefined> {
  const db = await getDb();
  return db.get("orders", id);
}

export async function putLocalOrder(order: LocalOrder): Promise<void> {
  const db = await getDb();
  await db.put("orders", order);
}

/** All locally cached orders, optionally scoped to one user (review M-1/M-3). */
export async function listLocalOrders(userId?: string): Promise<LocalOrder[]> {
  const db = await getDb();
  const all = await db.getAll("orders");
  return userId ? all.filter((o) => o.userId === userId) : all;
}

// ---------- outbox ----------

export async function getOutboxEntry(orderId: string): Promise<OutboxEntry | undefined> {
  const db = await getDb();
  return db.get("outbox", orderId);
}

export async function putOutboxEntry(entry: OutboxEntry): Promise<void> {
  const db = await getDb();
  await db.put("outbox", entry);
}

export async function deleteOutboxEntry(orderId: string): Promise<void> {
  const db = await getDb();
  await db.delete("outbox", orderId);
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  const db = await getDb();
  return db.getAll("outbox");
}

/**
 * Wipes all local stores (review M-1): called on explicit sign-out and when a different user
 * signs in on the same device, so one user's cached orders/outbox/identity never leak to another.
 */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  await Promise.all([db.clear("meta"), db.clear("orders"), db.clear("outbox")]);
}

/**
 * Deletes every Cache Storage entry the service worker populated (review M-1). The cached shells
 * hold no user data themselves (design.md/plan.md §8.1), but this removes any doubt and any stale
 * app-shell HTML for the next user on this device.
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}
