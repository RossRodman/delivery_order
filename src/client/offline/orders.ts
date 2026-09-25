import { computeOrder } from "@/domain";
import { api } from "@/client/api";
import type { Catalog, OrderInput, OrderSummary, OrderView, UserView } from "@/contracts/api";
import { getLocalOrder, putLocalOrder, type LocalOrder } from "./db";

function inputFromView(view: OrderView): OrderInput {
  return {
    dealerId: view.dealer.id,
    rate: view.rate,
    lines: view.lines.map((l) => ({ id: l.id, productId: l.product.id, qty: l.qty, discountCents: l.discountCents })),
  };
}

/** Online-first order load; falls back to the local copy when offline (plan.md §8.2). */
export async function loadOrder(id: string, userId: string): Promise<{ local: LocalOrder | null; fromServer: boolean }> {
  const result = await api.getOrder(id);
  if (result.ok) {
    const local: LocalOrder = {
      id,
      userId,
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
  userId: string,
  patch: Partial<Pick<LocalOrder, "server" | "syncState" | "lastError" | "priceChanges">> = {},
): Promise<LocalOrder> {
  const existing = await getLocalOrder(id);
  const local: LocalOrder = {
    id,
    userId: existing?.userId ?? userId,
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

/**
 * Renders a `LocalOrder` as an `OrderSummary` for the orders list (review M-3), so an order that
 * exists only in IndexedDB — queued, rejected on sync, or never yet reached the network — is
 * never findable only by knowing its URL. Totals are computed defensively: a line whose discount
 * no longer fits its cached price (M-2) is simply left out of the total rather than thrown.
 */
export function buildLocalSummary(local: LocalOrder, catalog: Catalog, me: UserView): OrderSummary {
  const dealer = catalog.dealers.find((d) => d.id === local.input.dealerId);
  const lines = local.input.lines
    .map((l) => {
      const product = catalog.products.find((p) => p.id === l.productId);
      if (!product) return null;
      if (l.discountCents > l.qty * product.unitPriceCents) return null;
      return {
        id: l.id,
        productId: l.productId,
        qty: l.qty,
        unitPriceCents: product.unitPriceCents,
        discountCents: l.discountCents,
        approval: { status: "none" as const, terms: null },
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  const computed = lines.length > 0 ? computeOrder({ rate: local.input.rate || 1, lines }) : null;

  return {
    id: local.id,
    number: local.server?.number ?? 0,
    status: local.server?.status ?? "draft",
    dealer: dealer ? { id: dealer.id, name: dealer.name } : { id: local.input.dealerId, name: "—" },
    createdBy: local.server?.createdBy ?? { id: me.id, name: me.name },
    rate: local.input.rate,
    totalUsdCents: computed?.totalUsdCents ?? 0,
    lineCount: local.input.lines.length,
    blockedLineCount: computed?.blockingLineIds.length ?? 0,
    hasRejectedLines: false,
    updatedAt: local.updatedAt,
    savedAt: local.server?.savedAt ?? null,
  };
}
