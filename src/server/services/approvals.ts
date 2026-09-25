import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { DecisionBody, OrderInput, OrderView, UserView } from "@/contracts/api";
import { sameTerms } from "@/domain";
import { getDb } from "@/server/db/client";
import { orderLines, orders } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";
import { upsertAndTransition, type MutationResult } from "./orders";
import { buildOrderView } from "./views";

/** E11 — persists the draft and marks blocked lines `pending`; order → pending_approval. */
export async function requestApproval(user: UserView, orderId: string, input: OrderInput): Promise<MutationResult> {
  return upsertAndTransition(user, orderId, input, "request-approval");
}

/** E12 — creator withdraws a request: pending lines → none, order → draft. Idempotent on drafts. */
export async function withdrawApproval(user: UserView, rawOrderId: string): Promise<OrderView> {
  const orderId = rawOrderId.toLowerCase();
  return getDb().transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order || order.createdBy !== user.id) throw new ApiError("NOT_FOUND");
    if (order.status === "saved") throw new ApiError("ORDER_IMMUTABLE");
    if (order.status === "pending_approval") {
      await tx
        .update(orderLines)
        .set({ approvalStatus: "none", decidedBy: null, decidedAt: null })
        .where(and(eq(orderLines.orderId, orderId), eq(orderLines.approvalStatus, "pending")));
      await tx.update(orders).set({ status: "draft", updatedAt: sql`now()` }).where(eq(orders.id, orderId));
    }
    return (await buildOrderView(tx, orderId))!;
  });
}

/**
 * E13 — owner approves/rejects one pending line. The approval stores the exact current terms (R4);
 * `expectedTerms` must match what the owner saw. When no line remains pending the order returns to
 * draft automatically (plan §6.4).
 */
export async function decideLine(
  owner: UserView,
  rawOrderId: string,
  rawLineId: string,
  body: DecisionBody,
): Promise<OrderView> {
  const orderId = rawOrderId.toLowerCase();
  const lineId = rawLineId.toLowerCase();
  return getDb().transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw new ApiError("NOT_FOUND");
    const [line] = await tx
      .select()
      .from(orderLines)
      .where(and(eq(orderLines.orderId, orderId), eq(orderLines.id, lineId)))
      .for("update");
    if (!line) throw new ApiError("NOT_FOUND");
    if (order.status !== "pending_approval" || line.approvalStatus !== "pending") {
      throw new ApiError("LINE_NOT_PENDING");
    }
    const current = {
      productId: line.productId,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      discountCents: line.discountCents,
    };
    const expected = { ...body.expectedTerms, productId: body.expectedTerms.productId.toLowerCase() };
    if (!sameTerms(current, expected)) {
      const view = await buildOrderView(tx, orderId);
      throw new ApiError("LINE_TERMS_CHANGED", { details: { line: view?.lines.find((l) => l.id === lineId) } });
    }

    const approve = body.decision === "approve";
    await tx
      .update(orderLines)
      .set({
        approvalStatus: approve ? "approved" : "rejected",
        approvedProductId: approve ? current.productId : null,
        approvedQty: approve ? current.qty : null,
        approvedUnitPriceCents: approve ? current.unitPriceCents : null,
        approvedDiscountCents: approve ? current.discountCents : null,
        decidedBy: owner.id,
        decidedAt: sql`now()`,
      })
      .where(and(eq(orderLines.orderId, orderId), eq(orderLines.id, lineId)));

    const [{ pending }] = await tx
      .select({ pending: sql<number>`count(*)::int` })
      .from(orderLines)
      .where(and(eq(orderLines.orderId, orderId), eq(orderLines.approvalStatus, "pending")));
    await tx
      .update(orders)
      .set(pending === 0 ? { status: "draft", updatedAt: sql`now()` } : { updatedAt: sql`now()` })
      .where(eq(orders.id, orderId));

    return (await buildOrderView(tx, orderId))!;
  });
}
