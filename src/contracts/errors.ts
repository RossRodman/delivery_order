/** Machine-readable error codes of the HTTP API (plan.md §6.1). Shared by server and client. */
export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "ORDER_ALREADY_SAVED",
  "ORDER_IMMUTABLE",
  "ORDER_NOT_EDITABLE",
  "LINE_TERMS_CHANGED",
  "LINE_NOT_PENDING",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_BELOW_MINIMUM",
  "RATE_ABOVE_MAXIMUM",
  "UNKNOWN_DEALER",
  "UNKNOWN_PRODUCT",
  "DISCOUNT_EXCEEDS_LINE_VALUE",
  "EMPTY_ORDER",
  "UNAPPROVED_BLOCKED_LINES",
  "NO_LINES_NEED_APPROVAL",
  "PRICE_MISMATCH",
  "TOTALS_MISMATCH",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Client-side only: the request never reached the server. */
export type ClientErrorCode = ErrorCode | "NETWORK";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ORDER_ALREADY_SAVED: 409,
  ORDER_IMMUTABLE: 409,
  ORDER_NOT_EDITABLE: 409,
  LINE_TERMS_CHANGED: 409,
  LINE_NOT_PENDING: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_BELOW_MINIMUM: 422,
  RATE_ABOVE_MAXIMUM: 422,
  UNKNOWN_DEALER: 422,
  UNKNOWN_PRODUCT: 422,
  DISCOUNT_EXCEEDS_LINE_VALUE: 422,
  EMPTY_ORDER: 422,
  UNAPPROVED_BLOCKED_LINES: 422,
  NO_LINES_NEED_APPROVAL: 422,
  PRICE_MISMATCH: 422,
  TOTALS_MISMATCH: 500,
  INTERNAL: 500,
};

/** Default human-readable messages (design.md copy where it exists). */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "The request is not valid.",
  UNAUTHENTICATED: "Please sign in.",
  FORBIDDEN: "Only the owner can do this.",
  NOT_FOUND: "Not found.",
  ORDER_ALREADY_SAVED: "This order was already saved with different content.",
  ORDER_IMMUTABLE: "Saved orders can't be changed.",
  ORDER_NOT_EDITABLE: "This order is awaiting approval. Cancel the request to edit it.",
  LINE_TERMS_CHANGED: "This line changed since you opened it.",
  LINE_NOT_PENDING: "This line is not awaiting approval.",
  UNSUPPORTED_MEDIA_TYPE: "Requests must be sent as application/json.",
  RATE_BELOW_MINIMUM: "Order rate must be at least 8,000 SDG/USD. Please update it and save again.",
  RATE_ABOVE_MAXIMUM: "Rate can't be above 100,000 SDG/USD.",
  UNKNOWN_DEALER: "Unknown dealer.",
  UNKNOWN_PRODUCT: "Unknown product on one or more lines.",
  DISCOUNT_EXCEEDS_LINE_VALUE: "A discount can't exceed its line value.",
  EMPTY_ORDER: "Add at least one product line.",
  UNAPPROVED_BLOCKED_LINES: "Line(s) need owner approval before saving.",
  NO_LINES_NEED_APPROVAL: "No line needs owner approval.",
  PRICE_MISMATCH: "A line's price doesn't match the current product price.",
  TOTALS_MISMATCH: "Order totals didn't match. Please try again.",
  INTERNAL: "Something went wrong. Please try again.",
};

/**
 * E6 overrides the message of RATE_BELOW_MINIMUM (same code, per the contract) with settings copy
 * (review m-7). Additive export so the settings screen can reuse it.
 */
export const GLOBAL_RATE_BELOW_MINIMUM_MESSAGE =
  "Global rate can't be below 8,000 SDG/USD. The current rate was kept.";

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** `{ "error": { code, message, details? } }` */
export interface ErrorEnvelope {
  error: ApiErrorBody;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
