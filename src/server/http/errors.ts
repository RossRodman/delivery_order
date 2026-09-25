import "server-only";
import { ZodError } from "zod";
import {
  ERROR_MESSAGES,
  ERROR_STATUS,
  isErrorCode,
  type ErrorCode,
  type ErrorEnvelope,
} from "@/contracts/errors";

/** An error that maps 1:1 to the API error envelope (plan §6.1). */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, options: { message?: string; details?: Record<string, unknown> } = {}) {
    super(options.message ?? ERROR_MESSAGES[code]);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options.details;
  }
}

/** JSON response; API data is never cacheable (plan §6.3, §8.1). */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: ApiError): Response {
  const body: ErrorEnvelope = {
    error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
  };
  return json(body, { status: err.status });
}

interface PgLikeError {
  code: string;
  message: string;
  detail?: string;
}

/** postgres-js errors may be wrapped (e.g. DrizzleQueryError.cause); find the SQLSTATE carrier. */
export function findPgError(err: unknown): PgLikeError | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      typeof (current as { code: unknown }).code === "string" &&
      /^[0-9A-Z]{5}$/.test((current as { code: string }).code)
    ) {
      return current as PgLikeError;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function lineIdsFrom(detail: string | undefined): string[] {
  return (detail ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Maps custom trigger SQLSTATEs (0001_guards.sql) and constraint violations to API errors. */
export function mapPgError(pg: PgLikeError): ApiError | null {
  switch (pg.code) {
    case "OS409":
      return new ApiError("ORDER_IMMUTABLE");
    case "OS422": {
      const code: ErrorCode = isErrorCode(pg.message) ? pg.message : "INTERNAL";
      const lineIds = lineIdsFrom(pg.detail);
      return new ApiError(code, lineIds.length && code !== "INTERNAL" ? { details: { lineIds } } : {});
    }
    case "OS500":
      return new ApiError("TOTALS_MISMATCH");
    case "23514": // check_violation
    case "22003": // numeric out of range
      return new ApiError("VALIDATION_FAILED", { details: { issues: [{ path: [], message: pg.message }] } });
    default:
      return null;
  }
}

export function zodToApiError(err: ZodError): ApiError {
  return new ApiError("VALIDATION_FAILED", {
    details: {
      issues: err.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message })),
    },
  });
}

/** Converts anything thrown by a handler into an error envelope response. */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof ApiError) return errorResponse(err);
  if (err instanceof ZodError) return errorResponse(zodToApiError(err));
  const pg = findPgError(err);
  const mapped = pg ? mapPgError(pg) : null;
  if (mapped) return errorResponse(mapped);
  console.error("Unhandled API error", err);
  return errorResponse(new ApiError("INTERNAL"));
}
