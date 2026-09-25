import { DecisionBodySchema, type OrderEnvelopeResponse } from "@/contracts/api";
import { requireUser } from "@/server/auth/session";
import { json } from "@/server/http/errors";
import { readJson, route, uuidParam } from "@/server/http/route";
import { decideLine } from "@/server/services/approvals";

/** E13 — owner approves or rejects one pending line. */
export const POST = route<{ id: string; lineId: string }>(async (req, ctx) => {
  const owner = await requireUser(req, "owner");
  const params = await ctx.params;
  const id = uuidParam(params.id);
  const lineId = uuidParam(params.lineId);
  const decision = await readJson(req, DecisionBodySchema);
  const body: OrderEnvelopeResponse = { order: await decideLine(owner, id, lineId, decision) };
  return json(body);
});
