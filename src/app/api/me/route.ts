import type { MeResponse } from "@/contracts/api";
import { requireUser } from "@/server/auth/session";
import { json } from "@/server/http/errors";
import { route } from "@/server/http/route";

/** E3 */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const body: MeResponse = { user };
  return json(body);
});
