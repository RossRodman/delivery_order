import { WithdrawBodySchema, type OrderEnvelopeResponse } from "@/contracts/api";
import { requireUser } from "@/server/auth/session";
import { json } from "@/server/http/errors";
import { readJson, route, uuidParam } from "@/server/http/route";
import { withdrawApproval } from "@/server/services/approvals";

/** E12 — creator cancels a pending approval request (body `{}`). */
export const POST = route<{ id: string }>(async (req, ctx) => {
  const user = await requireUser(req);
  const id = uuidParam((await ctx.params).id);
  await readJson(req, WithdrawBodySchema);
  const body: OrderEnvelopeResponse = { order: await withdrawApproval(user, id) };
  return json(body);
});
