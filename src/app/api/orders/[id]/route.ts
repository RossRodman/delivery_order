import { OrderInputSchema, type OrderResponse, type PutOrderResponse } from "@/contracts/api";
import { requireUser } from "@/server/auth/session";
import { json } from "@/server/http/errors";
import { readJson, route, uuidParam } from "@/server/http/route";
import { getOrderFor, upsertAndTransition } from "@/server/services/orders";

/** E8 — creator or owner. */
export const GET = route<{ id: string }>(async (req, ctx) => {
  const user = await requireUser(req);
  const id = uuidParam((await ctx.params).id);
  const body: OrderResponse = await getOrderFor(user, id);
  return json(body);
});

/** E9 — create or update a draft (idempotent by client-generated id). */
export const PUT = route<{ id: string }>(async (req, ctx) => {
  const user = await requireUser(req);
  const id = uuidParam((await ctx.params).id);
  const input = await readJson(req, OrderInputSchema);
  const { order, priceChanges } = await upsertAndTransition(user, id, input, "draft");
  const body: PutOrderResponse = { ...order, priceChanges };
  return json(body);
});
