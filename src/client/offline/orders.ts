import { api } from "@/client/api";
import type { OrderInput, OrderView } from "@/contracts/api";
import { getLocalOrder, putLocalOrder, type LocalOrder } from "./db";

function inputFromView(view: OrderView): OrderInput {
  return {
    dealerId: view.dealer.id,
    rate: view.rate,
    lines: view.lines.map((l) => ({ id: l.id, productId: l.product.id, qty: l.qty, discountCents: l.discountCents })),
  };
}

/** Online-first order load; falls back to the local copy when offline (plan.md §8.2). */
export async function loadOrder(id: string): Promise<{ local: LocalOrder | null; fromServer: boolean }> {
  const result = await api.getOrder(id);
  if (result.ok) {
    const local: LocalOrder = {
      id,
      input: inputFromView(result.data),
      server: result.data,
      syncState: "synced",
      lastError: null,
      priceChanges: [],
      updatedAt: new Date().toISOString(),
    };
    await putLocalOrder(local);
    return { local, fromServer: true };
  }
  const cached = await getLocalOrder(id);
  return { local: cached ?? null, fromServer: false };
}

/** Persists the adviser's current edits locally (used both online, as a cache, and offline). */
export async function saveLocalInput(
  id: string,
  input: OrderInput,
  patch: Partial<Pick<LocalOrder, "server" | "syncState" | "lastError" | "priceChanges">> = {},
): Promise<LocalOrder> {
  const existing = await getLocalOrder(id);
  const local: LocalOrder = {
    id,
    input,
    server: existing?.server ?? null,
    syncState: existing?.syncState ?? "local",
    lastError: existing?.lastError ?? null,
    priceChanges: existing?.priceChanges ?? [],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await putLocalOrder(local);
  return local;
}
