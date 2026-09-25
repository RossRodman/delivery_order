import type { Cents } from "./money";
import { classify, lineValue } from "./line";

export type LineState = "sand" | "red" | "blocked" | "approved";
export type ApprovalStatus = "none" | "pending" | "approved" | "rejected";

export interface LineTerms {
  productId: string;
  qty: number;
  unitPriceCents: Cents;
  discountCents: Cents;
}

/** `terms` are the exact terms the owner approved (approved_* columns), else null. */
export interface LineApproval {
  status: ApprovalStatus;
  terms: LineTerms | null;
}

/** R4: an approval is bound to product, qty, unit price and discount. */
export function sameTerms(a: LineTerms, b: LineTerms): boolean {
  return (
    a.productId === b.productId &&
    a.qty === b.qty &&
    a.unitPriceCents === b.unitPriceCents &&
    a.discountCents === b.discountCents
  );
}

/** A blocked line counts as "approved" only while its terms equal the approved terms. */
export function effectiveState(terms: LineTerms, approval: LineApproval): LineState {
  const cls = classify(terms.discountCents, lineValue(terms.qty, terms.unitPriceCents));
  if (
    cls === "blocked" &&
    approval.status === "approved" &&
    approval.terms !== null &&
    sameTerms(terms, approval.terms)
  ) {
    return "approved";
  }
  return cls;
}
