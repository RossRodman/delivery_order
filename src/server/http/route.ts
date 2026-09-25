import "server-only";
import type { z } from "zod";
import { ApiError, toErrorResponse, zodToApiError } from "./errors";

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type RouteParams<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
};

type Handler<P extends Record<string, string>> = (req: Request, ctx: RouteParams<P>) => Promise<Response>;

/**
 * Route wrapper: mutations must be `application/json` (CSRF defence, plan §5) → else 415;
 * every thrown error becomes the §6.1 envelope.
 */
export function route<P extends Record<string, string> = Record<string, string>>(
  handler: Handler<P>,
  options: { requireJson?: boolean } = {},
): (req: Request, ctx: RouteParams<P>) => Promise<Response> {
  const requireJson = options.requireJson ?? true;
  return async (req, ctx) => {
    try {
      if (requireJson && MUTATIONS.has(req.method) && !isJson(req)) {
        throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
      }
      return await handler(req, ctx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

function isJson(req: Request): boolean {
  const type = req.headers.get("content-type") ?? "";
  return type.split(";")[0].trim().toLowerCase() === "application/json";
}

/** Parses and validates a JSON body; unknown keys are stripped by the schema. Empty body = {}. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ApiError("VALIDATION_FAILED", {
        details: { issues: [{ path: [], message: "Body is not valid JSON" }] },
      });
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw zodToApiError(parsed.error);
  return parsed.data;
}

/** Validates a route path parameter as a UUID (else 404 — it can't exist). */
export function uuidParam(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError("NOT_FOUND");
  }
  return value.toLowerCase();
}
