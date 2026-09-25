import { GlobalRateBodySchema } from "@/contracts/api";
import { requireUser } from "@/server/auth/session";
import { json } from "@/server/http/errors";
import { readJson, route } from "@/server/http/route";
import { setGlobalRate } from "@/server/services/settings";

/** E6 — owner only. */
export const PUT = route(async (req) => {
  const user = await requireUser(req, "owner");
  const { globalRate } = await readJson(req, GlobalRateBodySchema);
  return json(await setGlobalRate(globalRate, user.id));
});
