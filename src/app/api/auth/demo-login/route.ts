import { asc, eq } from "drizzle-orm";
import { DemoLoginBodySchema, type DemoLoginResponse } from "@/contracts/api";
import { sessionCookie, signSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { ApiError, json } from "@/server/http/errors";
import { readJson, route } from "@/server/http/route";

/** E1 — demo login: pick a seeded user by role; returns a bearer token and sets the session cookie. */
export const POST = route(async (req) => {
  const { role } = await readJson(req, DemoLoginBodySchema);
  const [user] = await getDb()
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.role, role))
    .orderBy(asc(users.name))
    .limit(1);
  if (!user) throw new ApiError("NOT_FOUND", { message: `No demo ${role} is seeded.` });
  const { token, expiresAt } = await signSession(user.id);
  const body: DemoLoginResponse = { token, expiresAt: expiresAt.toISOString(), user };
  return json(body, { headers: { "Set-Cookie": sessionCookie(token) } });
});
