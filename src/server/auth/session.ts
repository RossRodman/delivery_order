import "server-only";
import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import type { Role, UserView } from "@/contracts/api";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

export const SESSION_COOKIE = "os_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters long");
  }
  return new TextEncoder().encode(secret);
}

/** Signs a session token. Claims: sub (user id), iat, exp — deliberately **no role** (plan §5). */
export async function signSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SECONDS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secretKey());
  return { token, expiresAt: new Date(exp * 1000) };
}

async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Bearer token first, else the session cookie (read from the Request, not next/headers). */
export function tokenFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    return match ? match[1].trim() : null;
  }
  return readCookie(req.headers.get("cookie"), SESSION_COOKIE);
}

/** Verifies the token and loads the user; the role comes from `users.role` only. */
export async function getSession(req: Request): Promise<UserView | null> {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const userId = await verifyToken(token);
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [user] = await getDb()
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user ?? null;
}

/** 401 UNAUTHENTICATED without a valid session; 403 FORBIDDEN when a role is required and differs. */
export async function requireUser(req: Request, role?: Role): Promise<UserView> {
  const user = await getSession(req);
  if (!user) throw new ApiError("UNAUTHENTICATED");
  if (role && user.role !== role) throw new ApiError("FORBIDDEN");
  return user;
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
