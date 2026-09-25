import { OrderInputSchema, type SaveOrderResponse } from "@/contracts/api";
import { requireUser } from "@/server/auth/session";
import { json } from "@/server/http/errors";
import { readJson, route, uuidParam } from "@/server/http/route";
import { upsertAndTransition } from "@/server/services/orders";

/**
 * E10 — save (creator). Idempotent by order id: an identical replay of a saved order returns it
 * with `replayed: true`; different content → 409 ORDER_ALREADY_SAVED. A refused save persists nothing.
 */
export const POST = route<{ id: string }>(async (req, ctx) => {
  const user = await requireUser(req);
  const id = uuidParam((await ctx.params).id);
  const input = await readJson(req, OrderInputSchema);
  const { order, replayed, priceChanges } = await upsertAndTransition(user, id, input, "save");
  const body: SaveOrderResponse = { order, replayed, priceChanges };
  return json(body);
});
