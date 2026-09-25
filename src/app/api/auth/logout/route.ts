import { clearedSessionCookie } from "@/server/auth/session";
import { route } from "@/server/http/route";

/** E2 — clears the session cookie (no body needed; clearing a cookie is harmless cross-site). */
export const POST = route(
  async () => new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookie(), "Cache-Control": "no-store" } }),
  { requireJson: false },
);
