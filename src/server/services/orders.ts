import "server-only";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type {
  OrderInput,
  OrderStatus,
  OrderView,
  PriceChange,
  UserView,
} from "@/contracts/api";
import { canonicalOrderKey } from "@/domain";
import { getDb } from "@/server/db/client";
import { dealers, orderLines, orders, products } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";
import { assertValidRate } from "./rate";
import { buildOrderView, listOrderSummaries, type Tx } from "./views";

export type Intent = "draft" | "save" | "request-approval";

export interface MutationResult {
  order: OrderView;
  priceChanges: PriceChange[];
  replayed: boolean;
}

function normalize(input: OrderInput): OrderInput {
  return {
    dealerId: input.dealerId.toLowerCase(),
    rate: input.rate,
    lines: input.lines.map((l) => ({ ...l, id: l.id.toLowerCase(), productId: l.productId.toLowerCase() })),
  };
}

async function lockOrder(tx: Tx, id: string) {
  const [row] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  return row ?? null;
}

async function assertDealerExists(tx: Tx, dealerId: string): Promise<void> {
  const [row] = await tx.select({ id: dealers.id }).from(dealers).where(eq(dealers.id, dealerId));
  if (!row) throw new ApiError("UNKNOWN_DEALER");
}

/**
 * The single order mutation service behind E9 (draft), E10 (save) and E11 (request-approval),
 * plan §6.4. Runs in one transaction; any thrown error rolls everything back (AC2: a refused save
 * persists nothing, not even this request's draft changes).
 */
export async function upsertAndTransition(
  user: UserView,
  rawOrderId: string,
  rawInput: OrderInput,
  intent: Intent,
): Promise<MutationResult> {
  const orderId = rawOrderId.toLowerCase();
  const input = normalize(rawInput);

  return getDb().transaction(async (tx) => {
    // 1. Create the draft row only after rate + dealer validation; then lock it.
    let order = await lockOrder(tx, orderId);
    if (!order) {
      assertValidRate(input.rate);
      await assertDealerExists(tx, input.dealerId);
      await tx
        .insert(orders)
        .values({ id: orderId, createdBy: user.id, dealerId: input.dealerId, rate: input.rate, status: "draft" })
        .onConflictDoNothing({ target: orders.id });
      order = await lockOrder(tx, orderId);
      if (!order) throw new Error(`order ${orderId} vanished after insert`);
    }

    // 2. Ownership and lifecycle.
    if (order.createdBy !== user.id) throw new ApiError("NOT_FOUND");
    if (order.status === "saved") {
      if (intent !== "save") throw new ApiError("ORDER_IMMUTABLE");
      const saved = await buildOrderView(tx, orderId);
      if (!saved) throw new ApiError("NOT_FOUND");
      const savedKey = canonicalOrderKey({
        dealerId: saved.dealer.id,
        rate: saved.rate,
        lines: saved.lines.map((l) => ({ id: l.id, productId: l.product.id, qty: l.qty, discountCents: l.discountCents })),
      });
      if (savedKey === canonicalOrderKey(input)) {
        return { order: saved, priceChanges: priceChangesAgainst(input, saved), replayed: true };
      }
      throw new ApiError("ORDER_ALREADY_SAVED", { details: { order: saved } });
    }
    if (order.status === "pending_approval") throw new ApiError("ORDER_NOT_EDITABLE");

    // Validation order: rate → dealer → products → discount ≤ value.
    assertValidRate(input.rate);
    await assertDealerExists(tx, input.dealerId);

    // 3. Unit prices come from the DB (R1), rows locked FOR SHARE against concurrent price edits.
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const priceRows = productIds.length
      ? await tx
          .select({ id: products.id, unitPriceCents: products.unitPriceCents })
          .from(products)
          .where(inArray(products.id, productIds))
          .for("share")
      : [];
    const priceOf = new Map(priceRows.map((p) => [p.id, p.unitPriceCents]));
    const unknown = input.lines.filter((l) => !priceOf.has(l.productId)).map((l) => l.id);
    if (unknown.length) throw new ApiError("UNKNOWN_PRODUCT", { details: { lineIds: unknown } });

    const priceChanges: PriceChange[] = input.lines
      .filter((l) => l.clientUnitPriceCents !== undefined && l.clientUnitPriceCents !== priceOf.get(l.productId))
      .map((l) => ({
        lineId: l.id,
        productId: l.productId,
        clientUnitPriceCents: l.clientUnitPriceCents!,
        serverUnitPriceCents: priceOf.get(l.productId)!,
      }));

    // 4. discount ≤ qty × DB price (R2).
    const tooBig = input.lines.filter((l) => l.discountCents > l.qty * priceOf.get(l.productId)!).map((l) => l.id);
    if (tooBig.length) throw new ApiError("DISCOUNT_EXCEEDS_LINE_VALUE", { details: { lineIds: tooBig } });

    // 5. Upsert lines. DO UPDATE SET is exactly the terms + position — approval columns are never
    //    written here; voiding happens only in trigger 4 when a term actually changes (M-1).
    if (input.lines.length) {
      await tx
        .insert(orderLines)
        .values(
          input.lines.map((l, position) => ({
            orderId,
            id: l.id,
            position,
            productId: l.productId,
            qty: l.qty,
            unitPriceCents: priceOf.get(l.productId)!,
            discountCents: l.discountCents,
            approvalStatus: "none" as const,
          })),
        )
        .onConflictDoUpdate({
          target: [orderLines.orderId, orderLines.id],
          set: {
            productId: sql`excluded.product_id`,
            qty: sql`excluded.qty`,
            unitPriceCents: sql`excluded.unit_price_cents`,
            discountCents: sql`excluded.discount_cents`,
            position: sql`excluded.position`,
          },
        });
    }
    const keepIds = input.lines.map((l) => l.id);
    await tx
      .delete(orderLines)
      .where(
        keepIds.length
          ? and(eq(orderLines.orderId, orderId), notInArray(orderLines.id, keepIds))
          : eq(orderLines.orderId, orderId),
      );
    await tx
      .update(orders)
      .set({ dealerId: input.dealerId, rate: input.rate, updatedAt: sql`now()` })
      .where(eq(orders.id, orderId));

    // 6. Recompute with the domain module and apply the intent.
    let view = await buildOrderView(tx, orderId);
    if (!view) throw new Error(`order ${orderId} missing`);

    if (intent === "request-approval") {
      if (view.lines.length === 0) throw new ApiError("EMPTY_ORDER");
      if (view.blockingLineIds.length === 0) throw new ApiError("NO_LINES_NEED_APPROVAL");
      await tx
        .update(orderLines)
        .set({
          approvalStatus: "pending",
          approvedProductId: null,
          approvedQty: null,
          approvedUnitPriceCents: null,
          approvedDiscountCents: null,
          decidedBy: null,
          decidedAt: null,
        })
        .where(and(eq(orderLines.orderId, orderId), inArray(orderLines.id, view.blockingLineIds)));
      await tx
        .update(orders)
        .set({ status: "pending_approval", updatedAt: sql`now()` })
        .where(eq(orders.id, orderId));
      view = (await buildOrderView(tx, orderId))!;
    }

    if (intent === "save") {
      if (view.lines.length === 0) throw new ApiError("EMPTY_ORDER");
      if (view.blockingLineIds.length > 0) {
        throw new ApiError("UNAPPROVED_BLOCKED_LINES", { details: { lineIds: view.blockingLineIds } });
      }
      // The DB trigger (orders_validate_save) re-checks everything: defence in depth.
      await tx
        .update(orders)
        .set({
          status: "saved",
          totalUsdCents: view.totals.usdCents,
          totalSdg: view.totals.sdg,
          savedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(orders.id, orderId));
      view = (await buildOrderView(tx, orderId))!;
    }

    return { order: view, priceChanges, replayed: false };
  });
}

function priceChangesAgainst(input: OrderInput, saved: OrderView): PriceChange[] {
  const priceById = new Map(saved.lines.map((l) => [l.id, l.unitPriceCents]));
  return input.lines
    .filter((l) => l.clientUnitPriceCents !== undefined && l.clientUnitPriceCents !== priceById.get(l.id))
    .map((l) => ({
      lineId: l.id,
      productId: l.productId,
      clientUnitPriceCents: l.clientUnitPriceCents!,
      serverUnitPriceCents: priceById.get(l.id)!,
    }));
}

/** E8 — creator or owner; anyone else gets 404. */
export async function getOrderFor(user: UserView, rawOrderId: string): Promise<OrderView> {
  const view = await buildOrderView(getDb(), rawOrderId.toLowerCase());
  if (!view) throw new ApiError("NOT_FOUND");
  if (user.role !== "owner" && view.createdBy.id !== user.id) throw new ApiError("NOT_FOUND");
  return view;
}

/** E7 */
export async function listOrders(user: UserView, filter: { status?: OrderStatus; limit?: number }) {
  return listOrderSummaries(getDb(), user, filter);
}
