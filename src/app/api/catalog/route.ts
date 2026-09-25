import { requireUser } from "@/server/auth/session";
import { json } from "@/server/http/errors";
import { route } from "@/server/http/route";
import { getCatalog } from "@/server/services/catalog";

/** E4 — dealers, products and the global rate. */
export const GET = route(async (req) => {
  await requireUser(req);
  return json(await getCatalog());
});
