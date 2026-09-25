import { OrderInputSchema, type RequestApprovalResponse } from "@/contracts/api";
import { requireUser } from "@/server/auth/session";
import { json } from "@/server/http/errors";
import { readJson, route, uuidParam } from "@/server/http/route";
import { requestApproval } from "@/server/services/approvals";

/** E11 — creator asks the owner to approve the blocked lines. */
export const POST = route<{ id: string }>(async (req, ctx) => {
  const user = await requireUser(req);
  const id = uuidParam((await ctx.params).id);
  const input = await readJson(req, OrderInputSchema);
  const { order, priceChanges } = await requestApproval(user, id, input);
  const body: RequestApprovalResponse = { order, priceChanges };
  return json(body);
});
