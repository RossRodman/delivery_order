import { assertNonNegativeInt, assertPositiveInt, assertSafeInt, DomainError } from "./errors";
import type { Cents } from "./money";
import { divRoundHalfUp } from "./money";

export type Classification = "sand" | "red" | "blocked";

/** R2: qty × unit price. */
export function lineValue(qty: number, unitPriceCents: Cents): Cents {
  assertPositiveInt(qty, "qty");
  assertPositiveInt(unitPriceCents, "unitPriceCents");
  return assertSafeInt(qty * unitPriceCents, "lineValue");
}

/** R2: line value − discount; throws if the discount is negative or exceeds the value. */
export function lineTotal(qty: number, unitPriceCents: Cents, discountCents: Cents): Cents {
  const value = lineValue(qty, unitPriceCents);
  assertNonNegativeInt(discountCents, "discountCents");
  if (discountCents > value) {
    throw new DomainError(`discount ${discountCents} exceeds line value ${value}`);
  }
  return value - discountCents;
}

/** R3 display: discount / value in basis points (1.94% → 194), rounded half-up. */
export function discountBasisPoints(discountCents: Cents, lineValueCents: Cents): number {
  assertNonNegativeInt(discountCents, "discountCents");
  assertPositiveInt(lineValueCents, "lineValueCents");
  return divRoundHalfUp(assertSafeInt(discountCents * 10_000, "discount*10000"), lineValueCents);
}

/** R3 classification with exact integer comparisons (never the rounded display value). */
export function classify(discountCents: Cents, lineValueCents: Cents): Classification {
  assertNonNegativeInt(discountCents, "discountCents");
  assertPositiveInt(lineValueCents, "lineValueCents");
  const d100 = assertSafeInt(discountCents * 100, "discount*100");
  if (d100 <= 3 * lineValueCents) return "sand";
  if (d100 <= 5 * lineValueCents) return "red";
  return "blocked";
}
