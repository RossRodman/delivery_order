import { OrdersListQuerySchema, type OrdersListResponse } from "@/contracts/api";
import { requireUser } from "@/server/auth/session";
import { json, zodToApiError } from "@/server/http/errors";
import { route } from "@/server/http/route";
import { listOrders } from "@/server/services/orders";

/** E7 — adviser: own orders; owner: all. `?status=&limit=` */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const query = OrdersListQuerySchema.safeParse(params);
  if (!query.success) throw zodToApiError(query.error);
  const body: OrdersListResponse = await listOrders(user, query.data);
  return json(body);
});
