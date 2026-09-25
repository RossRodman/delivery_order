import { deleteOutboxEntry, getOutboxEntry, listOutbox, putOutboxEntry, type OutboxEntry, type OutboxIntent } from "./db";
import type { OrderInput } from "@/contracts/api";

/**
 * Queues a draft/save intent for an order (plan.md §8.2): one entry per order, latest payload
 * wins, and a `save` intent is never downgraded back to `draft` by a later autosave tick.
 */
export async function enqueue(orderId: string, intent: OutboxIntent, payload: OrderInput): Promise<void> {
  const existing = await getOutboxEntry(orderId);
  const effectiveIntent: OutboxIntent = existing?.intent === "save" ? "save" : intent;
  const entry: OutboxEntry = {
    orderId,
    intent: effectiveIntent,
    payload,
    enqueuedAt: existing?.enqueuedAt ?? new Date().toISOString(),
    attempts: existing?.attempts ?? 0,
    nextAttemptAt: new Date().toISOString(),
  };
  await putOutboxEntry(entry);
}

export async function dequeue(orderId: string): Promise<void> {
  await deleteOutboxEntry(orderId);
}

/** FIFO by enqueue time — outbox is keyed by orderId, not insertion order. */
export async function listOutboxFifo(): Promise<OutboxEntry[]> {
  const entries = await listOutbox();
  return entries.sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
}

export async function outboxCount(): Promise<number> {
  const entries = await listOutbox();
  return entries.length;
}

export async function markAttempt(orderId: string): Promise<void> {
  const entry = await getOutboxEntry(orderId);
  if (!entry) return;
  await putOutboxEntry({ ...entry, attempts: entry.attempts + 1 });
}
