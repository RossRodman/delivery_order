import type { LineApproval, LineState, LineTerms } from "./approval";
import { effectiveState } from "./approval";
import { assertNonNegativeInt, assertPositiveInt, assertSafeInt, DomainError } from "./errors";
import type { Classification } from "./line";
import { classify, discountBasisPoints, lineTotal, lineValue } from "./line";
import type { Cents, Sdg } from "./money";

export interface OrderLineInput extends LineTerms {
  id: string;
  approval: LineApproval;
}

export interface ComputedLine {
  id: string;
  lineValueCents: Cents;
  lineTotalCents: Cents;
  discountBasisPoints: number;
  classification: Classification;
  state: LineState;
}

export interface ComputedOrder {
  lines: ComputedLine[];
  totalUsdCents: Cents;
  totalSdg: Sdg;
  blockingLineIds: string[];
  canSave: boolean;
}

/** R8: SDG = round-half-up(totalCents × rate / 100), multiplied in BigInt. */
export function sdgTotal(totalCents: Cents, rate: number): Sdg {
  assertNonNegativeInt(totalCents, "totalCents");
  assertPositiveInt(rate, "rate");
  const product = BigInt(totalCents) * BigInt(rate);
  const result = (product + BigInt(50)) / BigInt(100); // non-negative ⇒ half-up
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new DomainError("SDG total exceeds the safe integer range");
  }
  return Number(result);
}

/** Lines, totals and the save rule (no blocked line without a matching approval). */
export function computeOrder(input: { rate: number; lines: OrderLineInput[] }): ComputedOrder {
  const lines = input.lines.map((line): ComputedLine => {
    const value = lineValue(line.qty, line.unitPriceCents);
    return {
      id: line.id,
      lineValueCents: value,
      lineTotalCents: lineTotal(line.qty, line.unitPriceCents, line.discountCents),
      discountBasisPoints: discountBasisPoints(line.discountCents, value),
      classification: classify(line.discountCents, value),
      state: effectiveState(line, line.approval),
    };
  });
  const totalUsdCents = assertSafeInt(
    lines.reduce((sum, l) => sum + l.lineTotalCents, 0),
    "totalUsdCents",
  );
  const blockingLineIds = lines.filter((l) => l.state === "blocked").map((l) => l.id);
  return {
    lines,
    totalUsdCents,
    totalSdg: sdgTotal(totalUsdCents, input.rate),
    blockingLineIds,
    canSave: lines.length > 0 && blockingLineIds.length === 0,
  };
}

export interface CanonicalOrderInput {
  dealerId: string;
  rate: number;
  lines: ReadonlyArray<{ id: string; productId: string; qty: number; discountCents: number }>;
}

/**
 * Idempotency key for save replays: dealer, rate and lines in position order
 * (id, productId, qty, discountCents). Independent of object key order and extra fields.
 */
export function canonicalOrderKey(order: CanonicalOrderInput): string {
  return JSON.stringify([
    order.dealerId,
    order.rate,
    order.lines.map((l) => [l.id, l.productId, l.qty, l.discountCents]),
  ]);
}
