import { signSession } from "@/server/auth/session";
import type { RouteParams } from "@/server/http/route";
import { AMINA, YUSUF } from "./fixtures";

export const BASE = "http://localhost";

export interface RequestOptions {
  token?: string;
  cookie?: string;
  body?: unknown;
  /** Raw body string (overrides `body`). */
  rawBody?: string;
  contentType?: string | null;
  headers?: Record<string, string>;
}

/** Builds a real `Request` for calling route handlers directly. */
export function buildRequest(method: string, path: string, opts: RequestOptions = {}): Request {
  const headers = new Headers(opts.headers);
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  if (opts.cookie) headers.set("Cookie", opts.cookie);
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  const contentType = opts.contentType === undefined ? (method === "GET" ? null : "application/json") : opts.contentType;
  if (contentType) headers.set("Content-Type", contentType);
  return new Request(`${BASE}${path}`, { method, headers, body });
}

type AnyHandler = (req: Request, ctx: RouteParams<Record<string, string>>) => Promise<Response>;

export async function call<T = unknown>(
  handler: unknown,
  req: Request,
  params: Record<string, string> = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await (handler as AnyHandler)(req, { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

export async function tokenFor(userId: string): Promise<string> {
  return (await signSession(userId)).token;
}

export const adviserToken = () => tokenFor(AMINA.id);
export const ownerToken = () => tokenFor(YUSUF.id);

export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
