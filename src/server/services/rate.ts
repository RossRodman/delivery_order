import "server-only";
import { checkRate, MAX_RATE, MIN_RATE } from "@/domain";
import { ApiError } from "@/server/http/errors";

/** R5: never clamps — refuses with RATE_BELOW_MINIMUM / RATE_ABOVE_MAXIMUM. */
export function assertValidRate(rate: number): void {
  const result = checkRate(rate);
  if (result.ok) return;
  if (result.code === "RATE_BELOW_MINIMUM") throw new ApiError("RATE_BELOW_MINIMUM", { details: { min: MIN_RATE } });
  if (result.code === "RATE_ABOVE_MAXIMUM") throw new ApiError("RATE_ABOVE_MAXIMUM", { details: { max: MAX_RATE } });
  throw new ApiError("VALIDATION_FAILED", { details: { issues: [{ path: ["rate"], message: "Rate must be an integer" }] } });
}
