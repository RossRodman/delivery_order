import "server-only";
import { aliasedTable, asc, eq, sql, type SQL } from "drizzle-orm";
import type { LineView, OrderStatus, OrderSummary, OrderView, UserView } from "@/contracts/api";
import { computeOrder, type OrderLineInput } from "@/domain";
import type { Db } from "@/server/db/client";
import { dealers, orderLines, orders, products, users } from "@/server/db/schema";

/** A drizzle db or transaction handle. */
export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const decider = aliasedTable(users, "decider");

/** Builds the OrderView (plan §6.2) with `computeOrder` from the shared domain module. */
export async function buildOrderView(tx: Tx, orderId: string): Promise<OrderView | null> {
  const [head] = await tx
    .select({
      order: orders,
      creator: { id: users.id, name: users.name },
      dealer: { id: dealers.id, name: dealers.name, city: dealers.city },
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.createdBy))
    .innerJoin(dealers, eq(dealers.id, orders.dealerId))
    .where(eq(orders.id, orderId));
  if (!head) return null;

  const rows = await tx
    .select({
      line: orderLines,
      product: { id: products.id, sku: products.sku, name: products.name },
      decider: { id: decider.id, name: decider.name },
    })
    .from(orderLines)
    .innerJoin(products, eq(products.id, orderLines.productId))
    .leftJoin(decider, eq(decider.id, orderLines.decidedBy))
    .where(eq(orderLines.orderId, orderId))
    .orderBy(asc(orderLines.position), asc(orderLines.id));

  const domainLines: OrderLineInput[] = rows.map(({ line }) => ({
    id: line.id,
    productId: line.productId,
    qty: line.qty,
    unitPriceCents: line.unitPriceCents,
    discountCents: line.discountCents,
    approval: {
      status: line.approvalStatus,
      terms:
        line.approvalStatus === "approved" &&
        line.approvedProductId !== null &&
        line.approvedQty !== null &&
        line.approvedUnitPriceCents !== null &&
        line.approvedDiscountCents !== null
          ? {
              productId: line.approvedProductId,
              qty: line.approvedQty,
              unitPriceCents: line.approvedUnitPriceCents,
              discountCents: line.approvedDiscountCents,
            }
          : null,
    },
  }));
  const { order } = head;
  const computed = computeOrder({ rate: order.rate, lines: domainLines });

  const lines: LineView[] = rows.map(({ line, product, decider: d }, i) => {
    const c = computed.lines[i];
    return {
      id: line.id,
      position: line.position,
      product,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      discountCents: line.discountCents,
      lineValueCents: c.lineValueCents,
      lineTotalCents: c.lineTotalCents,
      discountBasisPoints: c.discountBasisPoints,
      classification: c.classification,
      state: c.state,
      approval: {
        status: line.approvalStatus,
        decidedBy: d && d.id ? { id: d.id, name: d.name } : null,
        decidedAt: line.decidedAt ? line.decidedAt.toISOString() : null,
      },
    };
  });

  const saved = order.status === "saved";
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    createdBy: head.creator,
    dealer: head.dealer,
    rate: order.rate,
    lines,
    totals: saved
      ? { usdCents: order.totalUsdCents ?? 0, sdg: order.totalSdg ?? 0 }
      : { usdCents: computed.totalUsdCents, sdg: computed.totalSdg },
    canSave: !saved && order.status === "draft" && computed.canSave,
    blockingLineIds: computed.blockingLineIds,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    savedAt: order.savedAt ? order.savedAt.toISOString() : null,
  };
}

/** R3 blocked + no approval bound to the current terms (same predicate as the DB save guard). */
const BLOCKED_UNAPPROVED = sql`(l.discount_cents * 100 > 5 * l.qty::bigint * l.unit_price_cents AND NOT (
  l.approval_status = 'approved' AND l.approved_product_id = l.product_id AND l.approved_qty = l.qty
  AND l.approved_unit_price_cents = l.unit_price_cents AND l.approved_discount_cents = l.discount_cents))`;

/** E7 — adviser: own orders only; owner: all orders. */
export async function listOrderSummaries(
  tx: Tx,
  viewer: UserView,
  filter: { status?: OrderStatus; limit?: number },
): Promise<{ orders: OrderSummary[]; counts: { pendingApproval: number } }> {
  const scope: SQL[] = [];
  if (viewer.role !== "owner") scope.push(sql`o.created_by = ${viewer.id}`);
  const where = [...scope];
  if (filter.status) where.push(sql`o.status = ${filter.status}`);
  const whereSql = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
  const scopeSql = scope.length ? sql`AND ${sql.join(scope, sql` AND `)}` : sql``;

  const rows = (await tx.execute(sql`
    SELECT o.id, o.number, o.status, o.rate, o.updated_at, o.saved_at,
           d.id AS dealer_id, d.name AS dealer_name, u.id AS user_id, u.name AS user_name,
           COALESCE(o.total_usd_cents, agg.total_usd, 0)::text AS total_usd,
           COALESCE(agg.line_count, 0)::int AS line_count,
           COALESCE(agg.blocked_count, 0)::int AS blocked_count,
           COALESCE(agg.rejected_count, 0)::int AS rejected_count
    FROM orders o
    JOIN dealers d ON d.id = o.dealer_id
    JOIN users u ON u.id = o.created_by
    LEFT JOIN LATERAL (
      SELECT sum(l.qty::bigint * l.unit_price_cents - l.discount_cents) AS total_usd,
             count(*) AS line_count,
             count(*) FILTER (WHERE ${BLOCKED_UNAPPROVED}) AS blocked_count,
             count(*) FILTER (WHERE l.approval_status = 'rejected') AS rejected_count
      FROM order_lines l WHERE l.order_id = o.id
    ) agg ON true
    ${whereSql}
    ORDER BY o.updated_at DESC, o.number DESC
    LIMIT ${filter.limit ?? 100}
  `)) as unknown as Array<Record<string, unknown>>;

  const [{ pending }] = (await tx.execute(
    sql`SELECT count(*)::int AS pending FROM orders o WHERE o.status = 'pending_approval' ${scopeSql}`,
  )) as unknown as Array<{ pending: number }>;

  return {
    orders: rows.map((r) => ({
      id: r.id as string,
      number: r.number as number,
      status: r.status as OrderStatus,
      dealer: { id: r.dealer_id as string, name: r.dealer_name as string },
      createdBy: { id: r.user_id as string, name: r.user_name as string },
      rate: r.rate as number,
      totalUsdCents: Number(r.total_usd),
      lineCount: r.line_count as number,
      blockedLineCount: r.blocked_count as number,
      hasRejectedLines: (r.rejected_count as number) > 0,
      updatedAt: toIso(r.updated_at),
      savedAt: r.saved_at ? toIso(r.saved_at) : null,
    })),
    counts: { pendingApproval: pending },
  };
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
