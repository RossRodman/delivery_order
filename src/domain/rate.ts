export const MIN_RATE = 8_000;
export const MAX_RATE = 100_000;

export type RateErrorCode = "RATE_BELOW_MINIMUM" | "RATE_ABOVE_MAXIMUM" | "RATE_NOT_INTEGER";
export type RateCheck = { ok: true } | { ok: false; code: RateErrorCode };

/** R5: integer SDG per USD, 8,000 ≤ rate ≤ 100,000. Never clamps. */
export function checkRate(rate: number): RateCheck {
  if (!Number.isSafeInteger(rate)) return { ok: false, code: "RATE_NOT_INTEGER" };
  if (rate < MIN_RATE) return { ok: false, code: "RATE_BELOW_MINIMUM" };
  if (rate > MAX_RATE) return { ok: false, code: "RATE_ABOVE_MAXIMUM" };
  return { ok: true };
}
