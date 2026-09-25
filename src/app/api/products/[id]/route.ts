import { PriceBodySchema, type PriceResponse } from "@/contracts/api";
import { requireUser } from "@/server/auth/session";
import { json } from "@/server/http/errors";
import { readJson, route, uuidParam } from "@/server/http/route";
import { updateProductPrice } from "@/server/services/catalog";

/** E5 — owner only. */
export const PATCH = route<{ id: string }>(async (req, ctx) => {
  await requireUser(req, "owner");
  const id = uuidParam((await ctx.params).id);
  const { unitPriceCents } = await readJson(req, PriceBodySchema);
  const body: PriceResponse = { product: await updateProductPrice(id, unitPriceCents) };
  return json(body);
});
